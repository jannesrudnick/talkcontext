/**
 * Drives the recording in the tab: rrweb for the replay, the semantic recorder
 * for the agent log, plus console/network from the MAIN world.
 * Everything is buffered and sent every second over a port to the background,
 * which writes it to IndexedDB.
 */
import { record } from "rrweb";
import { injectScript } from "#imports";
import {
  COMPONENT_PROBE_EVENT,
  MAIN_WORLD_SOURCE,
  RECORDER_PORT,
  type LiveTextEvent,
  type MainWorldMessage,
  type PortDownMessage,
  type PortUpMessage,
} from "@/lib/messages";
import { startSemanticRecorder, type SemanticRecorder } from "@/lib/recorder/semantic";
import { describe, meaningful } from "@/lib/recorder/describe";
import { newId } from "@/lib/settings";
import type { ChunkKind, ChunkPayloads, ComponentInfo, FeedbackItem, Settings } from "@/lib/types";
import { FeedbackManager } from "./feedback";
import type { ElementRef } from "@/lib/qa/types";

/** Anything belonging to the overlay shows up neither in the replay nor in the log. */
export const OVERLAY_TAG = "qey-overlay";

/**
 * Does the node belong to the overlay? Events from the shadow root are retargeted
 * to the host, but `closest` stops at the shadow boundary - so go through
 * the root node.
 */
export function isOverlayNode(node: EventTarget | Node | null): boolean {
  if (!(node instanceof Node)) return false;
  const root = node.getRootNode();
  const element = root instanceof ShadowRoot ? root.host : node instanceof Element ? node : node.parentElement;
  return element?.closest(OVERLAY_TAG) != null;
}

type Buffers = { [K in ChunkKind]: ChunkPayloads[K] };

const emptyBuffers = (): Buffers => ({
  rrweb: [],
  events: [],
  effects: [],
  cursor: [],
  console: [],
  network: [],
  audio: [],
  feedback: [],
  strokes: [],
  screenshots: [],
  live: [],
});

export interface TargetInfo {
  rect: DOMRect;
  label: string;
  ref?: ElementRef;
}

export class RecordingController {
  private port: Browser.runtime.Port | null = null;
  private buffers = emptyBuffers();
  private flushTimer: number | undefined;
  private stopRrweb: (() => void) | undefined;
  private semantic: SemanticRecorder | null = null;
  private mainWorldInjected = false;
  private running = false;
  private lastTarget: Element | null = null;
  private targetListeners = new Set<(target: TargetInfo | null) => void>();
  private settings: Settings | null = null;
  private componentRequests = new Map<string, (info: ComponentInfo | null) => void>();
  private lastErrorShot = 0;
  private cleanups: Array<() => void> = [];
  feedback: FeedbackManager | null = null;

  get isRunning() {
    return this.running;
  }

  /** As early as possible - so console/network are captured from the first request. */
  injectMainWorld() {
    if (this.mainWorldInjected) return;
    this.mainWorldInjected = true;
    window.addEventListener("message", this.onMainWorldMessage);
    void injectScript("/main-world.js", { keepInDom: false }).catch(() => {
      this.mainWorldInjected = false;
    });
  }

  start(settings: Settings) {
    if (this.running) return;
    this.running = true;
    this.settings = settings;
    this.injectMainWorld();
    this.connect();

    const blockSelector = [OVERLAY_TAG, settings.replay.blockSelector.trim()].filter(Boolean).join(",");
    this.stopRrweb = record({
      emit: (event) => this.push("rrweb", event),
      blockSelector,
      maskAllInputs: settings.replay.maskAllInputs,
      maskInputOptions: { password: true },
      recordCanvas: settings.replay.recordCanvas,
      inlineStylesheet: true,
      collectFonts: true,
      sampling: { mousemove: 50, scroll: 150, input: "last" },
      slimDOMOptions: { script: true, comment: true, headFavicon: true, headWhitespace: true },
    });

    this.semantic = startSemanticRecorder({
      config: settings.recorder,
      onEvent: (event) => this.push("events", event),
      onEffect: (id, effect) => this.push("effects", { id, effect }),
      onCursor: (sample) => this.push("cursor", sample),
      onTarget: (el) => this.setTarget(el),
      isOwn: isOverlayNode,
    });

    this.feedback = new FeedbackManager({
      save: (item) => {
        this.push("feedback", item);
        this.flush();
      },
      saveStrokes: (strokes) => {
        for (const stroke of strokes) this.push("strokes", stroke);
      },
      logNote: (item) => this.logFeedback(item),
      probeComponent: (el) => this.probeComponent(el),
      captureHtml: settings.recorder.captureHtml,
      isOwn: isOverlayNode,
    });
    this.feedback.setPenColor(settings.feedback.penColor);
    this.listenForFeedback(settings);

    this.send({ type: "page", url: location.href, title: document.title });
    this.flushTimer = window.setInterval(() => this.flush(), 1000);
    window.addEventListener("pagehide", this.onPageHide);
  }

  /* ------------------------------------------------------------- Feedback */

  private listenForFeedback(settings: Settings) {
    const onContextMenu = (event: MouseEvent) => {
      // Alt+right-click lets the native context menu through.
      if (!settings.feedback.contextMenu || event.altKey) return;
      const target = event.composedPath()[0] ?? event.target;
      if (isOverlayNode(target as Node) || !(event.target instanceof Element)) return;
      event.preventDefault();
      event.stopPropagation();
      void this.feedback?.begin(meaningful(event.target), "contextmenu");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const editable = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (editable) return;
      if (event.key === "Escape") {
        if (this.feedback?.active) this.feedback.close();
        this.feedback?.togglePen(false);
      }
    };
    document.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("keydown", onKeyDown, true);
    this.cleanups.push(() => {
      document.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("keydown", onKeyDown, true);
    });
  }

  onLive(event: LiveTextEvent) {
    this.feedback?.onLive(event);
  }

  private logFeedback(item: FeedbackItem) {
    const said = item.speech.join(" ");
    const text = [item.text, said].filter(Boolean).join(" – ");
    this.push("events", {
      id: newId("e"),
      ts: item.activeTo ?? Date.now(),
      type: item.source === "marker" ? "marker" : "note",
      url: item.url,
      target: item.target,
      detail: { text: `F${item.index}${text ? `: ${text}` : ""}`, feedbackId: item.id },
    });
  }

  private probeComponent(el: Element): Promise<ComponentInfo | null> {
    const requestId = newId("probe_");
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.componentRequests.delete(requestId);
        resolve(null);
      }, 400);
      this.componentRequests.set(requestId, (info) => {
        window.clearTimeout(timer);
        this.componentRequests.delete(requestId);
        resolve(info);
      });
      el.dispatchEvent(new CustomEvent(COMPONENT_PROBE_EVENT, { detail: requestId, bubbles: false }));
    });
  }

  private maybeErrorScreenshot() {
    if (!this.settings?.feedback.screenshotOnError || !this.feedback) return;
    if (Date.now() - this.lastErrorShot < 4000) return;
    this.lastErrorShot = Date.now();
    // The error often only becomes visible shortly after (toast, message).
    window.setTimeout(() => void this.feedback?.screenshot("error"), 500);
  }

  stop() {
    if (!this.running) return;
    this.feedback?.finish();
    this.feedback?.togglePen(false);
    this.feedback = null;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.running = false;
    this.stopRrweb?.();
    this.semantic?.stop();
    this.semantic = null;
    window.clearInterval(this.flushTimer);
    window.removeEventListener("pagehide", this.onPageHide);
    this.flush();
    this.setTarget(null);
  }

  note(text: string, kind: "note" | "marker" = "note") {
    this.semantic?.note(text, kind);
    this.flush();
  }

  /** Description of the element a note would be attached to right now. */
  currentTarget(): ElementRef | undefined {
    return this.lastTarget?.isConnected ? describe(this.lastTarget, { captureHtml: false, html: false }) : undefined;
  }

  onTarget(listener: (target: TargetInfo | null) => void) {
    this.targetListeners.add(listener);
    return () => {
      this.targetListeners.delete(listener);
    };
  }

  /* ----------------------------------------------------------- internal */

  private setTarget(el: Element | null) {
    if (el) this.lastTarget = el;
    const info: TargetInfo | null = el
      ? {
          rect: el.getBoundingClientRect(),
          label: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ""),
        }
      : null;
    for (const listener of this.targetListeners) listener(info);
  }

  private onPageHide = () => {
    this.feedback?.finish();
    this.flush();
  };

  private onMainWorldMessage = (event: MessageEvent) => {
    if (event.source !== window || !this.running) return;
    const data = event.data as MainWorldMessage | undefined;
    if (!data || data.source !== MAIN_WORLD_SOURCE) return;
    if (data.type === "component") {
      this.componentRequests.get(data.requestId)?.(data.info);
      return;
    }
    if (data.type === "console") {
      this.push("console", data.entry);
      if (data.entry.level === "error") {
        this.maybeErrorScreenshot();
        this.push("events", {
          id: data.entry.id,
          ts: data.entry.ts,
          type: "console",
          url: location.href,
          detail: { level: "error", message: data.entry.message.slice(0, 300), source: data.entry.source },
        });
      }
    } else if (data.type === "network") {
      this.push("network", data.entry);
      const failed = data.entry.status === 0 || data.entry.status >= 400;
      if (failed) {
        this.maybeErrorScreenshot();
        this.push("events", {
          id: data.entry.id,
          ts: data.entry.ts,
          type: "network",
          url: location.href,
          detail: {
            method: data.entry.method,
            url: data.entry.url,
            status: data.entry.status,
            durationMs: data.entry.durationMs,
            error: data.entry.error,
          },
        });
      }
    } else if (data.type === "navigation") {
      this.semantic?.checkNavigation(data.kind);
      this.send({ type: "page", url: location.href, title: document.title });
    }
  };

  private push<K extends ChunkKind>(kind: K, item: ChunkPayloads[K][number]) {
    (this.buffers[kind] as unknown[]).push(item);
    // Don't keep large snapshots in memory longer than needed.
    if (kind === "rrweb" && this.buffers.rrweb.length > 400) this.flush();
  }

  private connect() {
    if (this.port) return;
    try {
      this.port = browser.runtime.connect({ name: RECORDER_PORT });
    } catch {
      this.port = null;
      return;
    }
    this.port.onMessage.addListener((message: PortDownMessage) => {
      if (message.type === "flush") {
        this.feedback?.finish();
        this.flush();
        this.send({ type: "flushed", token: message.token });
      }
    });
    this.port.onDisconnect.addListener(() => {
      this.port = null;
      // Service worker was restarted - reconnect while we are recording.
      if (this.running) window.setTimeout(() => this.connect(), 200);
    });
  }

  private send(message: PortUpMessage) {
    if (!this.port) this.connect();
    try {
      this.port?.postMessage(message);
    } catch {
      this.port = null;
    }
  }

  flush() {
    const buffers = this.buffers;
    this.buffers = emptyBuffers();
    for (const kind of Object.keys(buffers) as ChunkKind[]) {
      const data = buffers[kind];
      if (data.length) this.send({ type: "chunk", kind, data });
    }
  }
}
