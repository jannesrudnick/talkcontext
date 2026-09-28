/**
 * Service Worker: haelt den Aufnahmezustand, nimmt die Datenspuren der
 * Content-Scripts entgegen, schreibt sie in IndexedDB und steuert das
 * Offscreen-Dokument fuer das Mikrofon.
 *
 * Der Zustand liegt in `storage.session`, nicht in Variablen - der Service
 * Worker kann jederzeit beendet und neu gestartet werden.
 */
import { storage } from "#imports";
import { appendChunk, putRecording, readTrack, updateRecording, deleteRecording } from "@/lib/db";
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
import type { ActiveRecording, EnvironmentSnapshot, RecordingMeta, TabState } from "@/lib/types";

const activeItem = storage.defineItem<ActiveRecording | null>("session:active", { fallback: null });
const overlayItem = storage.defineItem<Record<string, boolean>>("session:overlay", { fallback: {} });

const OFFSCREEN_PATH = "/offscreen.html";

export default defineBackground(() => {
  /* ------------------------------------------------------------ Helfer */

  const ports = new Map<number, Browser.runtime.Port>();
  const pendingFlushes = new Map<string, () => void>();
  let pendingAudioStop: ((event: Extract<OffscreenEvent, { type: "qey:audio-stopped" }>) => void) | null = null;
  // Alle Schreibzugriffe laufen seriell - so ist beim Stoppen garantiert alles auf der Platte.
  let writeChain: Promise<unknown> = Promise.resolve();
  const enqueue = (task: () => Promise<unknown>) => {
    writeChain = writeChain.then(task).catch((error) => console.error("[qey] Schreiben fehlgeschlagen", error));
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
      const message: TabMessage = { type: "qey:state", state: await tabState(tabId, tab.url ?? "") };
      await browser.tabs.sendMessage(tabId, message);
    } catch {
      /* Tab ohne Content-Script (chrome://, Web Store, ...) */
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
      justification: "Mikrofon-Aufnahme fuer die gesprochene Erklaerung waehrend einer QA-Session",
    });
  }

  async function closeOffscreen() {
    try {
      await browser.offscreen.closeDocument();
    } catch {
      /* war schon zu */
    }
  }

  /* ---------------------------------------------------------- Aufnahme */

  function titleFor(url: string, startedAt: number) {
    let host = url;
    try {
      host = new URL(url).host || url;
    } catch {
      /* URL bleibt wie sie ist */
    }
    const date = new Date(startedAt).toLocaleString("de-DE", {
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
    if (current) throw new Error("Es laeuft bereits eine Aufnahme in einem anderen Tab.");
    if (tab.id == null) throw new Error("Tab ohne ID");

    const settings = await getSettings();
    const url = tab.url ?? "";
    const env = findEnvironment(url, settings.environments);
    const environment: EnvironmentSnapshot | undefined = env
      ? {
          id: env.id,
          name: env.name,
          color: env.color,
          notes: env.notes,
          // Geheime Werte gar nicht erst in die Aufnahme kopieren.
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

    const active: ActiveRecording = {
      recordingId,
      tabId: tab.id,
      startedAt,
      audio: settings.audio.enabled ? "starting" : "off",
    };
    await activeItem.setValue(active);

    if (settings.audio.enabled) {
      try {
        await ensureOffscreen();
        const request: OffscreenRequest = { target: "offscreen", type: "start-audio", recordingId };
        // Das frisch erzeugte Dokument registriert seinen Listener evtl. erst einen Tick spaeter.
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
    const stopped = await new Promise<Extract<OffscreenEvent, { type: "qey:audio-stopped" }> | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 4000);
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

  async function finalize(recordingId: string) {
    const [events, consoleEntries, network] = await Promise.all([
      readTrack(recordingId, "events"),
      readTrack(recordingId, "console"),
      readTrack(recordingId, "network"),
    ]);
    const endedAt = Date.now();
    await updateRecording(recordingId, (meta) => ({
      ...meta,
      status: "ready",
      endedAt,
      durationMs: endedAt - meta.startedAt,
      counts: {
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
      await sendToTab(active.tabId, { type: "qey:saved", recordingId: active.recordingId });
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
    const reached = await sendToTab(tab.id, { type: "qey:toggle-overlay" });
    // Kein Content-Script (Browser-Seiten, Web Store): stattdessen die Aufnahmen zeigen.
    if (!reached) await openPage("recordings");
  }

  /* --------------------------------------------------------- Listener */

  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    browser.contextMenus.create({ id: "qey-recordings", title: "Aufnahmen öffnen", contexts: ["action"] });
    browser.contextMenus.create({ id: "qey-settings", title: "Einstellungen", contexts: ["action"] });
    if (reason === "install") await openPage("welcome");
  });

  browser.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === "qey-recordings") void openPage("recordings");
    if (info.menuItemId === "qey-settings") void openPage("settings");
  });

  browser.action.onClicked.addListener((tab) => void toggleOverlay(tab));

  browser.commands.onCommand.addListener(async (command, tab) => {
    const target = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (command === "toggle-overlay") await toggleOverlay(target);
    if (command === "toggle-recording" && target?.id != null) {
      await sendToTab(target.id, { type: "qey:toggle-recording" });
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

  // Aufnahmen, die beim Browser-Neustart noch "liefen", sauber abschliessen.
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
        // Erst nach allen vorher eingereihten Schreibvorgaengen melden.
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
        case "qey:hello":
          return tab?.id != null ? tabState(tab.id, tab.url ?? "") : null;
        case "qey:start": {
          if (!tab) throw new Error("Kein Tab");
          const request = message as Extract<ContentRequest, { type: "qey:start" }>;
          await startRecording(tab, request.viewport, request.pageTitle);
          return tabState(tab.id!, tab.url ?? "");
        }
        case "qey:stop":
          return stopRecording();
        case "qey:discard":
          return stopRecording({ discard: true });
        case "qey:overlay":
          if (tab?.id != null) await setOverlay(tab.id, (message as { visible: boolean }).visible);
          return true;
        case "qey:open": {
          const request = message as Extract<ContentRequest, { type: "qey:open" }>;
          await openPage(request.page, request.recordingId);
          return true;
        }
        /* ---- Offscreen ---- */
        case "qey:audio-started": {
          const event = message as Extract<OffscreenEvent, { type: "qey:audio-started" }>;
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
        case "qey:audio-error": {
          const event = message as Extract<OffscreenEvent, { type: "qey:audio-error" }>;
          await updateRecording(event.recordingId, (meta) => ({ ...meta, audioError: event.message }));
          const active = await activeItem.getValue();
          if (active?.recordingId === event.recordingId) {
            await activeItem.setValue({ ...active, audio: event.denied ? "denied" : "error", audioError: event.message });
            await pushState(active.tabId);
          }
          await closeOffscreen();
          return true;
        }
        case "qey:audio-level": {
          const active = await activeItem.getValue();
          if (active) await sendToTab(active.tabId, { type: "qey:audio-level", level: (message as { level: number }).level });
          return true;
        }
        case "qey:audio-stopped":
          pendingAudioStop?.(message as Extract<OffscreenEvent, { type: "qey:audio-stopped" }>);
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

  // Wenn sich die Einstellungen aendern (z.B. Umgebungen), offene Overlays aktualisieren.
  storage.watch("local:settings", async () => {
    const tabs = await browser.tabs.query({});
    const overlay = await overlayItem.getValue();
    const active = await activeItem.getValue();
    for (const tab of tabs) {
      if (tab.id != null && (overlay[String(tab.id)] || active?.tabId === tab.id)) void pushState(tab.id);
    }
  });
});
