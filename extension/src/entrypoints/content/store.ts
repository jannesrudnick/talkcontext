/**
 * Minimaler Zustand fuer das Overlay - bewusst ohne Bibliothek.
 */
import { useSyncExternalStore } from "react";
import type { TabState } from "@/lib/types";
import { request } from "./api";

export interface OverlayState {
  tab: TabState | null;
  audioLevel: number;
  savedId: string | null;
  error: string | null;
  busy: boolean;
  actions: {
    toggleOverlay(): void;
    toggleRecording(): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    discard(): Promise<void>;
    hide(): void;
    open(page: "recordings" | "settings", recordingId?: string): void;
  };
}

type Listener = () => void;

export function createStore<S>(init: (set: (partial: Partial<S>) => void, get: () => S) => S) {
  let state: S;
  const listeners = new Set<Listener>();
  const set = (partial: Partial<S>) => {
    state = { ...state, ...partial };
    for (const listener of listeners) listener();
  };
  const get = () => state;
  state = init(set, get);
  return {
    getState: get,
    setState: set,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const overlayStore = createStore<OverlayState>((set, get) => {
  const run = async (task: () => Promise<unknown>) => {
    set({ busy: true, error: null });
    try {
      await task();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ busy: false });
    }
  };

  const setVisible = (visible: boolean) => {
    const tab = get().tab;
    if (tab) set({ tab: { ...tab, overlayVisible: visible } });
    void request({ type: "qey:overlay", visible }).catch(() => undefined);
  };

  return {
    tab: null,
    audioLevel: 0,
    savedId: null,
    error: null,
    busy: false,
    actions: {
      toggleOverlay() {
        const tab = get().tab;
        if (!tab || tab.recording) return;
        setVisible(!tab.overlayVisible);
      },
      toggleRecording() {
        const tab = get().tab;
        if (!tab) return;
        if (tab.recording) void get().actions.stop();
        else void get().actions.start();
      },
      start: () =>
        run(async () => {
          set({ savedId: null });
          const tab = await request<TabState>({
            type: "qey:start",
            viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
            pageTitle: document.title,
          });
          set({ tab });
        }),
      stop: () =>
        run(async () => {
          const tab = get().tab;
          if (tab?.recording) set({ tab: { ...tab, recording: { ...tab.recording, stopping: true } } });
          await request({ type: "qey:stop" });
        }),
      discard: () =>
        run(async () => {
          await request({ type: "qey:discard" });
        }),
      hide() {
        setVisible(false);
      },
      open(page, recordingId) {
        void request({ type: "qey:open", page, recordingId }).catch(() => undefined);
      },
    },
  };
});

export function useOverlay<T>(selector: (state: OverlayState) => T): T {
  return useSyncExternalStore(overlayStore.subscribe, () => selector(overlayStore.getState()));
}

export function useStore<S, T>(store: ReturnType<typeof createStore<S>>, selector: (state: S) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
