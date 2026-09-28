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
  | { type: "qey:open"; page: "recordings" | "settings"; recordingId?: string };

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
  | { type: "qey:saved"; recordingId: string };

/** Background -> Offscreen. */
export type OffscreenRequest =
  | { target: "offscreen"; type: "start-audio"; recordingId: string }
  | { target: "offscreen"; type: "stop-audio" };

/** Offscreen -> Background. */
export type OffscreenEvent =
  | { type: "qey:audio-started"; recordingId: string; startedAt: number; mimeType: string }
  | { type: "qey:audio-error"; recordingId: string; denied: boolean; message: string }
  | { type: "qey:audio-level"; level: number }
  | { type: "qey:audio-chunk"; recordingId: string }
  | { type: "qey:audio-stopped"; recordingId: string; durationMs: number; size: number };

/** Seite im Fenster (MAIN world) -> Content-Script, per window.postMessage. */
export const MAIN_WORLD_SOURCE = "qey-main-world";

export type MainWorldMessage =
  | { source: typeof MAIN_WORLD_SOURCE; type: "console"; entry: import("./types").ConsoleEntry }
  | { source: typeof MAIN_WORLD_SOURCE; type: "network"; entry: import("./types").NetworkEntry }
  | { source: typeof MAIN_WORLD_SOURCE; type: "navigation"; kind: "push" | "replace" | "popstate" | "hash" };
