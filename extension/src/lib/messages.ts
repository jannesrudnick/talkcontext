/**
 * Nachrichten zwischen Content-Script, Background und Offscreen-Dokument.
 *
 * Content-Script <-> Background laeuft ueber zwei Wege:
 *   - `runtime.sendMessage` fuer Befehle mit Antwort (start, stop, ...)
 *   - einen langlebigen Port fuer die Datenspuren, damit Reihenfolge und
 *     Zustellung beim Seitenwechsel stimmen.
 */
import type { ChunkKind, ChunkPayloads, TabState } from "./types";

export const RECORDER_PORT = "qey-recorder";

/** Content-Script -> Background (sendMessage). */
export type ContentRequest =
  | { type: "qey:hello" }
  | { type: "qey:start"; viewport: { width: number; height: number; dpr: number }; pageTitle: string }
  | { type: "qey:stop" }
  | { type: "qey:discard" }
  | { type: "qey:overlay"; visible: boolean }
  | { type: "qey:open"; page: "recordings" | "settings"; recordingId?: string }
  /** Sichtbaren Bereich des Tabs als Screenshot ablegen. */
  | { type: "qey:capture"; reason: import("./types").Screenshot["reason"]; feedbackId?: string }
  /** Naechste laufende Feedback-Nummer (F1, F2, ...) - zaehlt ueber Seitenwechsel hinweg. */
  | { type: "qey:next-feedback-index" };

/** Content-Script -> Background (Port). */
export type PortUpMessage =
  | { type: "chunk"; kind: ChunkKind; data: ChunkPayloads[ChunkKind] }
  | { type: "page"; url: string; title: string }
  | { type: "flushed"; token: string };

/** Background -> Content-Script (Port). */
export type PortDownMessage = { type: "flush"; token: string };

/** Background -> Content-Script (tabs.sendMessage). */
export type TabMessage =
  | { type: "qey:state"; state: TabState }
  | { type: "qey:toggle-overlay" }
  | { type: "qey:toggle-recording" }
  | { type: "qey:audio-level"; level: number }
  | { type: "qey:saved"; recordingId: string }
  | { type: "qey:live"; event: LiveTextEvent };

/** Live-Transkript: Zwischenstand (delta) oder fertiger Abschnitt (final). */
export type LiveTextEvent =
  | { kind: "delta"; itemId: string; delta: string }
  | { kind: "final"; itemId: string; text: string; start: number; end: number };

/** Background -> Offscreen. */
export type OffscreenRequest =
  | {
      target: "offscreen";
      type: "start-audio";
      recordingId: string;
      live: { apiKey: string; model: string; language: string } | null;
    }
  | { target: "offscreen"; type: "stop-audio" };

/** Offscreen -> Background. */
export type OffscreenEvent =
  | { type: "qey:audio-started"; recordingId: string; startedAt: number; mimeType: string }
  | { type: "qey:audio-error"; recordingId: string; denied: boolean; message: string }
  | { type: "qey:audio-level"; level: number }
  | { type: "qey:audio-chunk"; recordingId: string }
  | { type: "qey:audio-stopped"; recordingId: string; durationMs: number; size: number }
  | { type: "qey:live-status"; recordingId: string; state: import("./types").LiveState; error?: string }
  | { type: "qey:live-text"; recordingId: string; event: LiveTextEvent };

/** Seite im Fenster (MAIN world) -> Content-Script, per window.postMessage. */
export const MAIN_WORLD_SOURCE = "qey-main-world";

export type MainWorldMessage =
  | { source: typeof MAIN_WORLD_SOURCE; type: "console"; entry: import("./types").ConsoleEntry }
  | { source: typeof MAIN_WORLD_SOURCE; type: "network"; entry: import("./types").NetworkEntry }
  | { source: typeof MAIN_WORLD_SOURCE; type: "navigation"; kind: "push" | "replace" | "popstate" | "hash" }
  | {
      source: typeof MAIN_WORLD_SOURCE;
      type: "component";
      requestId: string;
      info: import("./types").ComponentInfo | null;
    };

/** Content-Script -> MAIN world: als CustomEvent direkt auf dem Element ausgeloest. */
export const COMPONENT_PROBE_EVENT = "qey:component-probe";
