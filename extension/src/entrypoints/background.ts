/**
 * Service worker: holds the recording state, receives the data tracks from the
 * content scripts, writes them to IndexedDB and controls the
 * offscreen document for the microphone.
 *
 * State lives in `storage.session`, not in variables - the service
 * worker can be terminated and restarted at any time.
 */
import { storage } from "#imports";
import { appendChunk, deleteRecording, putRecording, readLatestById, readTrack, updateRecording } from "@/lib/db";
import {
  RECORDER_PORT,
  type ContentRequest,
  type OffscreenEvent,
  type OffscreenRequest,
  type PortDownMessage,
  type PortUpMessage,
  type TabMessage,
} from "@/lib/messages";
import { findEnvironment, getSettings, newId } from "@/lib/settings";
import type { ActiveRecording, EnvironmentSnapshot, RecordingMeta, Screenshot, TabState } from "@/lib/types";

const activeItem = storage.defineItem<ActiveRecording | null>("session:active", { fallback: null });
const overlayItem = storage.defineItem<Record<string, boolean>>("session:overlay", { fallback: {} });

const OFFSCREEN_PATH = "/offscreen.html";

export default defineBackground(() => {
  /* ----------------------------------------------------------- Helpers */

  const ports = new Map<number, Browser.runtime.Port>();
  const pendingFlushes = new Map<string, () => void>();
  let pendingAudioStop: ((event: Extract<OffscreenEvent, { type: "talkcontext:audio-stopped" }>) => void) | null = null;
  // All writes run serially - so everything is guaranteed to be on disk when stopping.
  let writeChain: Promise<unknown> = Promise.resolve();
  const enqueue = (task: () => Promise<unknown>) => {
    writeChain = writeChain.then(task).catch((error) => console.error("[talkcontext] Write failed", error));
    return writeChain;
  };

  async function tabState(tabId: number, url: string): Promise<TabState> {
    const [active, overlay, settings] = await Promise.all([activeItem.getValue(), overlayItem.getValue(), getSettings()]);
    const mine = active?.tabId === tabId ? active : null;
    return {
      overlayVisible: Boolean(mine) || Boolean(overlay[String(tabId)]),
      recording: mine,
      busyElsewhere: Boolean(active) && !mine,
      environment: findEnvironment(url, settings.environments),
      settings,
    };
  }

  async function pushState(tabId: number) {
    try {
      const tab = await browser.tabs.get(tabId);
      const message: TabMessage = { type: "talkcontext:state", state: await tabState(tabId, tab.url ?? "") };
      await browser.tabs.sendMessage(tabId, message);
    } catch {
      /* Tab without content script (chrome://, Web Store, ...) */
    }
  }

  async function sendToTab(tabId: number, message: TabMessage): Promise<boolean> {
    try {
      await browser.tabs.sendMessage(tabId, message);
      return true;
    } catch {
      return false;
    }
  }

  async function openPage(page: "recordings" | "settings" | "welcome", recordingId?: string) {
    const hash = page === "recordings" ? (recordingId ? `#/recordings/${recordingId}` : "#/recordings") : `#/${page}`;
    await browser.tabs.create({ url: browser.runtime.getURL(`/options.html${hash}`) });
  }

  /* --------------------------------------------------------- Offscreen */

  async function ensureOffscreen() {
    const url = browser.runtime.getURL(OFFSCREEN_PATH);
    const contexts = await browser.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT" as Browser.runtime.ContextType],
      documentUrls: [url],
    });
    if (contexts.length) return;
    await browser.offscreen.createDocument({
      url,
      reasons: ["USER_MEDIA" as Browser.offscreen.Reason],
      justification: "Microphone recording for spoken explanations during a QA session",
    });
  }

  async function closeOffscreen() {
    try {
      await browser.offscreen.closeDocument();
    } catch {
      /* already closed */
    }
  }

  /* --------------------------------------------------------- Recording */

  function titleFor(url: string, startedAt: number) {
    let host = url;
    try {
      host = new URL(url).host || url;
    } catch {
      /* keep URL as is */
    }
    const date = new Date(startedAt).toLocaleString("en-US", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${host} · ${date}`;
  }

  async function startRecording(
    tab: Browser.tabs.Tab,
    viewport: RecordingMeta["viewport"],
    pageTitle: string,
  ): Promise<ActiveRecording> {
    const current = await activeItem.getValue();
    if (current) throw new Error("A recording is already running in another tab.");
    if (tab.id == null) throw new Error("Tab has no ID");

    const settings = await getSettings();
    const url = tab.url ?? "";
    const env = findEnvironment(url, settings.environments);
    const environment: EnvironmentSnapshot | undefined = env
      ? {
          id: env.id,
          name: env.name,
          color: env.color,
          notes: env.notes,
          // Don't copy secret values into the recording in the first place.
          variables: env.variables.map((v) => ({ key: v.key, value: v.secret ? "••••••" : v.value, secret: v.secret })),
        }
      : undefined;

    const startedAt = Date.now();
    const recordingId = newId("rec_");
    const meta: RecordingMeta = {
      id: recordingId,
      title: titleFor(url, startedAt),
      status: "recording",
      startedAt,
      durationMs: 0,
      initialUrl: url,
      lastUrl: url,
      pageTitle,
      environment,
      viewport,
      userAgent: navigator.userAgent,
      language: settings.language,
      counts: { events: 0, clicks: 0, errors: 0, notes: 0, pages: 1, requests: 0 },
    };
    await putRecording(meta);

    const tr = settings.transcription;
    const liveKey = (tr.liveProvider === "soniox" ? tr.sonioxKey : tr.openaiKey).trim();
    const liveConfig =
      settings.audio.enabled && tr.live && liveKey
        ? { provider: tr.liveProvider, apiKey: liveKey, model: tr.liveModel, language: settings.language }
        : null;

    const active: ActiveRecording = {
      recordingId,
      tabId: tab.id,
      startedAt,
      audio: settings.audio.enabled ? "starting" : "off",
      live: liveConfig ? "connecting" : "off",
      nextFeedbackIndex: 1,
    };
    await activeItem.setValue(active);

    if (settings.audio.enabled) {
      try {
        await ensureOffscreen();
        const request: OffscreenRequest = { target: "offscreen", type: "start-audio", recordingId, live: liveConfig };
        // The freshly created document may register its listener a tick later.
        for (let attempt = 0; ; attempt++) {
          try {
            await browser.runtime.sendMessage(request);
            break;
          } catch (error) {
            if (attempt >= 4) throw error;
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
        }
      } catch (error) {
        await activeItem.setValue({ ...active, audio: "error", audioError: String(error) });
      }
    }
    return (await activeItem.getValue()) ?? active;
  }

  async function flushTab(tabId: number) {
    const port = ports.get(tabId);
    if (!port) return;
    const token = newId();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1500);
      pendingFlushes.set(token, () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        port.postMessage({ type: "flush", token } satisfies PortDownMessage);
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
    pendingFlushes.delete(token);
  }

  async function stopAudio(recordingId: string, audioState: ActiveRecording["audio"]) {
    if (audioState !== "on" && audioState !== "starting") return;
    const stopped = await new Promise<Extract<OffscreenEvent, { type: "talkcontext:audio-stopped" }> | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 7000);
      pendingAudioStop = (event) => {
        clearTimeout(timer);
        resolve(event);
      };
      browser.runtime
        .sendMessage({ target: "offscreen", type: "stop-audio" } satisfies OffscreenRequest)
        .catch(() => resolve(null));
    });
    pendingAudioStop = null;
    if (stopped && stopped.recordingId === recordingId) {
      await updateRecording(recordingId, (meta) =>
        meta.audio ? { ...meta, audio: { ...meta.audio, durationMs: stopped.durationMs, size: stopped.size } } : meta,
      );
    }
    await closeOffscreen();
  }

  /* ------------------------------------------------------- Screenshots */

  // Chrome only allows ~2 captureVisibleTab calls per second.
  let lastCapture = 0;
  let captureChain: Promise<unknown> = Promise.resolve();

  function capture(
    recordingId: string,
    tab: Browser.tabs.Tab,
    reason: Screenshot["reason"],
    feedbackId?: string,
  ): Promise<{ id: string; ts: number }> {
    const run = async () => {
      const wait = lastCapture + 600 - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastCapture = Date.now();
      // captureVisibleTab captures the window's active tab - if that is not
      // the recording tab, better no image than a wrong one.
      const current = await browser.tabs.get(tab.id!);
      if (!current.active) throw new Error("Recording tab is not in the foreground");
      const dataUrl = await browser.tabs.captureVisibleTab(current.windowId, { format: "jpeg", quality: 85 });
      const blob = await (await fetch(dataUrl)).blob();
      const bitmap = await createImageBitmap(blob);
      const screenshot: Screenshot = {
        id: newId("shot_"),
        ts: lastCapture,
        reason,
        feedbackId,
        url: tab.url ?? "",
        width: bitmap.width,
        height: bitmap.height,
        blob,
      };
      bitmap.close();
      await enqueue(() => appendChunk(recordingId, "screenshots", [screenshot]));
      return { id: screenshot.id, ts: screenshot.ts };
    };
    const result = captureChain.then(run, run);
    captureChain = result.catch(() => undefined);
    return result;
  }

  async function finalize(recordingId: string) {
    const [events, consoleEntries, network, feedback, screenshots, live] = await Promise.all([
      readTrack(recordingId, "events"),
      readTrack(recordingId, "console"),
      readTrack(recordingId, "network"),
      readLatestById(recordingId, "feedback"),
      readTrack(recordingId, "screenshots"),
      readTrack(recordingId, "live"),
    ]);
    const endedAt = Date.now();
    const settings = await getSettings();
    await updateRecording(recordingId, (meta) => ({
      ...meta,
      status: "ready",
      endedAt,
      durationMs: endedAt - meta.startedAt,
      // The live transcript is already a complete transcript - then
      // nothing needs to be transcribed after stopping.
      transcript:
        meta.transcript ??
        (live.length && meta.audio
          ? {
              source: settings.transcription.liveProvider === "soniox" ? ("soniox-live" as const) : ("openai-live" as const),
              model: settings.transcription.liveProvider === "soniox" ? "stt-rt-v5" : settings.transcription.liveModel,
              createdAt: endedAt,
              segments: live
                .filter((segment) => segment.text)
                .sort((a, b) => a.start - b.start)
                .map((segment) => ({
                  t: Math.max(0, segment.start - meta.audio!.startedAt),
                  endT: Math.max(0, segment.end - meta.audio!.startedAt),
                  text: segment.text,
                  final: true,
                })),
            }
          : undefined),
      counts: {
        feedback: feedback.filter((item) => !item.discarded).length,
        screenshots: screenshots.length,
        events: events.length,
        clicks: events.filter((e) => e.type === "click" || e.type === "dblclick").length,
        notes: events.filter((e) => e.type === "note" || e.type === "marker").length,
        pages: Math.max(1, events.filter((e) => e.type === "navigate").length),
        errors:
          consoleEntries.filter((c) => c.level === "error").length +
          network.filter((n) => n.status === 0 || n.status >= 400).length,
        requests: network.length,
      },
    }));
  }

  async function stopRecording({ discard = false } = {}) {
    const active = await activeItem.getValue();
    if (!active || active.stopping) return null;
    await activeItem.setValue({ ...active, stopping: true });

    await flushTab(active.tabId);
    await stopAudio(active.recordingId, active.audio);
    await writeChain;

    if (discard) await deleteRecording(active.recordingId);
    else await finalize(active.recordingId);

    await activeItem.setValue(null);
    await pushState(active.tabId);

    if (!discard) {
      await sendToTab(active.tabId, { type: "talkcontext:saved", recordingId: active.recordingId });
      const settings = await getSettings();
      if (settings.openAfterStop) await openPage("recordings", active.recordingId);
    }
    return active.recordingId;
  }

  async function setOverlay(tabId: number, visible: boolean) {
    const overlay = await overlayItem.getValue();
    await overlayItem.setValue({ ...overlay, [String(tabId)]: visible });
    await pushState(tabId);
  }

  async function toggleOverlay(tab: Browser.tabs.Tab | undefined) {
    if (tab?.id == null) return;
    const reached = await sendToTab(tab.id, { type: "talkcontext:toggle-overlay" });
    // No content script (browser pages, Web Store): show the recordings instead.
    if (!reached) await openPage("recordings");
  }

  /* --------------------------------------------------------- Listeners */

  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    browser.contextMenus.create({ id: "talkcontext-recordings", title: "Open recordings", contexts: ["action"] });
    browser.contextMenus.create({ id: "talkcontext-settings", title: "Settings", contexts: ["action"] });
    if (reason === "install") await openPage("welcome");
  });

  browser.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === "talkcontext-recordings") void openPage("recordings");
    if (info.menuItemId === "talkcontext-settings") void openPage("settings");
  });

  browser.action.onClicked.addListener((tab) => void toggleOverlay(tab));

  browser.commands.onCommand.addListener(async (command, tab) => {
    const target = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (command === "toggle-overlay") await toggleOverlay(target);
    if (command === "toggle-recording" && target?.id != null) {
      await sendToTab(target.id, { type: "talkcontext:toggle-recording" });
    }
  });

  browser.tabs.onRemoved.addListener(async (tabId) => {
    const active = await activeItem.getValue();
    if (active?.tabId === tabId) await stopRecording();
    const overlay = await overlayItem.getValue();
    if (String(tabId) in overlay) {
      const { [String(tabId)]: _removed, ...rest } = overlay;
      await overlayItem.setValue(rest);
    }
  });

  // Cleanly finalize recordings that were still "running" when the browser restarted.
  browser.runtime.onStartup.addListener(async () => {
    const active = await activeItem.getValue();
    if (active) {
      await finalize(active.recordingId);
      await activeItem.setValue(null);
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== RECORDER_PORT) return;
    const tabId = port.sender?.tab?.id;
    if (tabId == null) return;
    ports.set(tabId, port);
    port.onDisconnect.addListener(() => {
      if (ports.get(tabId) === port) ports.delete(tabId);
    });
    port.onMessage.addListener(async (message: PortUpMessage) => {
      if (message.type === "flushed") {
        // Only report once all previously queued writes are done.
        void writeChain.then(() => pendingFlushes.get(message.token)?.());
        return;
      }
      const active = await activeItem.getValue();
      if (!active || active.tabId !== tabId) return;
      if (message.type === "chunk") {
        void enqueue(() => appendChunk(active.recordingId, message.kind, message.data));
      } else if (message.type === "page") {
        void enqueue(() =>
          updateRecording(active.recordingId, (meta) => ({ ...meta, lastUrl: message.url, pageTitle: message.title })),
        );
      }
    });
  });

  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const message = raw as ContentRequest | OffscreenEvent | { target?: string };
    if ("target" in message && message.target === "offscreen") return undefined;

    const handle = async (): Promise<unknown> => {
      const tab = sender.tab;
      switch ((message as { type: string }).type) {
        case "talkcontext:hello":
          return tab?.id != null ? tabState(tab.id, tab.url ?? "") : null;
        case "talkcontext:start": {
          if (!tab) throw new Error("No tab");
          const request = message as Extract<ContentRequest, { type: "talkcontext:start" }>;
          await startRecording(tab, request.viewport, request.pageTitle);
          return tabState(tab.id!, tab.url ?? "");
        }
        case "talkcontext:stop":
          return stopRecording();
        case "talkcontext:discard":
          return stopRecording({ discard: true });
        case "talkcontext:overlay":
          if (tab?.id != null) await setOverlay(tab.id, (message as { visible: boolean }).visible);
          return true;
        case "talkcontext:open": {
          const request = message as Extract<ContentRequest, { type: "talkcontext:open" }>;
          await openPage(request.page, request.recordingId);
          return true;
        }
        case "talkcontext:capture": {
          const active = await activeItem.getValue();
          if (!active || tab?.id !== active.tabId) throw new Error("No recording in this tab");
          const request = message as Extract<ContentRequest, { type: "talkcontext:capture" }>;
          return capture(active.recordingId, tab, request.reason, request.feedbackId);
        }
        case "talkcontext:next-feedback-index": {
          const active = await activeItem.getValue();
          if (!active) return 1;
          await activeItem.setValue({ ...active, nextFeedbackIndex: active.nextFeedbackIndex + 1 });
          return active.nextFeedbackIndex;
        }
        /* ---- Offscreen ---- */
        case "talkcontext:live-status": {
          const event = message as Extract<OffscreenEvent, { type: "talkcontext:live-status" }>;
          const active = await activeItem.getValue();
          if (active?.recordingId === event.recordingId) {
            await activeItem.setValue({ ...active, live: event.state, liveError: event.error });
            await pushState(active.tabId);
          }
          return true;
        }
        case "talkcontext:live-text": {
          const event = message as Extract<OffscreenEvent, { type: "talkcontext:live-text" }>;
          const active = await activeItem.getValue();
          if (active?.recordingId !== event.recordingId) return true;
          if (event.event.kind === "final" && event.event.text) {
            const { itemId, text, start, end } = event.event;
            void enqueue(() => appendChunk(event.recordingId, "live", [{ id: itemId, text, start, end }]));
          }
          await sendToTab(active.tabId, { type: "talkcontext:live", event: event.event });
          return true;
        }
        case "talkcontext:audio-started": {
          const event = message as Extract<OffscreenEvent, { type: "talkcontext:audio-started" }>;
          await updateRecording(event.recordingId, (meta) => ({
            ...meta,
            audio: { mimeType: event.mimeType, startedAt: event.startedAt, durationMs: 0, size: 0 },
          }));
          const active = await activeItem.getValue();
          if (active?.recordingId === event.recordingId) {
            await activeItem.setValue({ ...active, audio: "on" });
            await pushState(active.tabId);
          }
          return true;
        }
        case "talkcontext:audio-error": {
          const event = message as Extract<OffscreenEvent, { type: "talkcontext:audio-error" }>;
          await updateRecording(event.recordingId, (meta) => ({ ...meta, audioError: event.message }));
          const active = await activeItem.getValue();
          if (active?.recordingId === event.recordingId) {
            await activeItem.setValue({ ...active, audio: event.denied ? "denied" : "error", audioError: event.message });
            await pushState(active.tabId);
          }
          await closeOffscreen();
          return true;
        }
        case "talkcontext:audio-level": {
          const active = await activeItem.getValue();
          if (active) await sendToTab(active.tabId, { type: "talkcontext:audio-level", level: (message as { level: number }).level });
          return true;
        }
        case "talkcontext:audio-stopped":
          pendingAudioStop?.(message as Extract<OffscreenEvent, { type: "talkcontext:audio-stopped" }>);
          return true;
        default:
          return undefined;
      }
    };

    handle().then(
      (result) => sendResponse({ ok: true, result }),
      (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  });

  // When settings change (e.g. environments), update open overlays.
  storage.watch("local:settings", async () => {
    const tabs = await browser.tabs.query({});
    const overlay = await overlayItem.getValue();
    const active = await activeItem.getValue();
    for (const tab of tabs) {
      if (tab.id != null && (overlay[String(tab.id)] || active?.tabId === tab.id)) void pushState(tab.id);
    }
  });
});
