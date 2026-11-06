/**
 * Messages between content script, background and offscreen document.
 *
 * Content script <-> background uses two channels:
 *   - `runtime.sendMessage` for commands with a response (start, stop, ...)
 *   - a long-lived port for the data tracks, so ordering and delivery
 *     stay correct across page navigations.
 */
import type { ChunkKind, ChunkPayloads, TabState } from "./types";

export const RECORDER_PORT = "talkcontext-recorder";

/** Content script -> background (sendMessage). */
export type ContentRequest =
  | { type: "talkcontext:hello" }
  | { type: "talkcontext:start"; viewport: { width: number; height: number; dpr: number }; pageTitle: string }
  | { type: "talkcontext:stop" }
  | { type: "talkcontext:discard" }
  | { type: "talkcontext:overlay"; visible: boolean }
  | { type: "talkcontext:open"; page: "recordings" | "settings"; recordingId?: string }
  /** Store the visible area of the tab as a screenshot. */
  | { type: "talkcontext:capture"; reason: import("./types").Screenshot["reason"]; feedbackId?: string }
  /** Next sequential feedback number (F1, F2, ...) - counts across page navigations. */
  | { type: "talkcontext:next-feedback-index" }
  /** Team comments - the background holds the Supabase client. */
  | { type: "talkcontext:comments"; request: import("./team-bridge").CommentOp };

/** Content script -> background (port). */
export type PortUpMessage =
  | { type: "chunk"; kind: ChunkKind; data: ChunkPayloads[ChunkKind] }
  | { type: "page"; url: string; title: string }
  | { type: "flushed"; token: string };

/** Background -> content script (port). */
export type PortDownMessage = { type: "flush"; token: string };

/** Background -> content script (tabs.sendMessage). */
export type TabMessage =
  | { type: "talkcontext:state"; state: TabState }
  | { type: "talkcontext:toggle-overlay" }
  | { type: "talkcontext:toggle-recording" }
  | { type: "talkcontext:audio-level"; level: number }
  | { type: "talkcontext:saved"; recordingId: string }
  | { type: "talkcontext:live"; event: LiveTextEvent }
  /** From the comments list: show the overlay and open this thread. */
  | { type: "talkcontext:open-thread"; threadId: string };

/** Live transcript: interim state (delta) or finished segment (final). */
export type LiveTextEvent =
  | { kind: "delta"; itemId: string; delta: string }
  | { kind: "final"; itemId: string; text: string; start: number; end: number };

/** Background -> Offscreen. */
export type OffscreenRequest =
  | {
      target: "offscreen";
      type: "start-audio";
      recordingId: string;
      live: { provider: "openai" | "soniox"; apiKey: string; model: string; language: string } | null;
    }
  | { target: "offscreen"; type: "stop-audio" };

/** Offscreen -> Background. */
export type OffscreenEvent =
  | { type: "talkcontext:audio-started"; recordingId: string; startedAt: number; mimeType: string }
  | { type: "talkcontext:audio-error"; recordingId: string; denied: boolean; message: string }
  | { type: "talkcontext:audio-level"; level: number }
  | { type: "talkcontext:audio-chunk"; recordingId: string }
  | { type: "talkcontext:audio-stopped"; recordingId: string; durationMs: number; size: number }
  | { type: "talkcontext:live-status"; recordingId: string; state: import("./types").LiveState; error?: string }
  | { type: "talkcontext:live-text"; recordingId: string; event: LiveTextEvent };

/** Page in the window (MAIN world) -> content script, via window.postMessage. */
export const MAIN_WORLD_SOURCE = "talkcontext-main-world";

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

/** Content script -> MAIN world: dispatched as a CustomEvent directly on the element. */
export const COMPONENT_PROBE_EVENT = "talkcontext:component-probe";
