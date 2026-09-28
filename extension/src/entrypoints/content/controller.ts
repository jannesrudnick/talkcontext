/**
 * Steuert die Aufnahme im Tab: rrweb fuer das Replay, der semantische Recorder
 * fuer das Agenten-Protokoll, dazu Konsole/Netzwerk aus der MAIN world.
 * Alles wird gepuffert und sekundenweise ueber einen Port an den Background
 * geschickt, der es in IndexedDB schreibt.
 */
import { record } from "rrweb";
import { injectScript } from "#imports";
import {
  MAIN_WORLD_SOURCE,
  RECORDER_PORT,
  type MainWorldMessage,
  type PortDownMessage,
  type PortUpMessage,
} from "@/lib/messages";
import { startSemanticRecorder, type SemanticRecorder } from "@/lib/recorder/semantic";
import { describe } from "@/lib/recorder/describe";
import type { ChunkKind, ChunkPayloads, Settings } from "@/lib/types";
import type { ElementRef } from "@shared/types";

/** Alles, was zum Overlay gehoert, taucht weder im Replay noch im Protokoll auf. */
export const OVERLAY_TAG = "qey-overlay";

/**
 * Gehoert der Knoten zum Overlay? Events aus dem Shadow Root werden auf den
 * Host umgelenkt, `closest` endet aber an der Shadow-Grenze - deshalb ueber
 * den Root-Knoten gehen.
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

  get isRunning() {
    return this.running;
  }

  /** So frueh wie moeglich - damit Konsole/Netzwerk ab dem ersten Request mitlaufen. */
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

    this.send({ type: "page", url: location.href, title: document.title });
    this.flushTimer = window.setInterval(() => this.flush(), 1000);
    window.addEventListener("pagehide", this.onPageHide);
  }

  stop() {
    if (!this.running) return;
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

  /** Beschreibung des Elements, an das eine Notiz jetzt gehaengt wuerde. */
  currentTarget(): ElementRef | undefined {
    return this.lastTarget?.isConnected ? describe(this.lastTarget, { captureHtml: false, html: false }) : undefined;
  }

  onTarget(listener: (target: TargetInfo | null) => void) {
    this.targetListeners.add(listener);
    return () => {
      this.targetListeners.delete(listener);
    };
  }

  /* ------------------------------------------------------------- intern */

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

  private onPageHide = () => this.flush();

  private onMainWorldMessage = (event: MessageEvent) => {
    if (event.source !== window || !this.running) return;
    const data = event.data as MainWorldMessage | undefined;
    if (!data || data.source !== MAIN_WORLD_SOURCE) return;
    if (data.type === "console") {
      this.push("console", data.entry);
      if (data.entry.level === "error") {
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
    // Grosse Snapshots nicht unnoetig im Speicher halten.
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
        this.flush();
        this.send({ type: "flushed", token: message.token });
      }
    });
    this.port.onDisconnect.addListener(() => {
      this.port = null;
      // Service Worker wurde neu gestartet - neu verbinden, solange wir aufnehmen.
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
