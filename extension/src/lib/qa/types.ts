/**
 * Data model of the QA recording.
 *
 * The artifact is deliberately textual/structured instead of a video: an agent
 * should understand without a screenshot which DOM element the mouse was on,
 * what was clicked and what the user said meanwhile.
 */

export type QaMode = "extension";

/** Description of a DOM element, robust enough for an agent to find it again. */
export interface ElementRef {
  /** Prefers data-testid / #id / [aria-label], otherwise a short CSS path. */
  selector: string;
  xpath: string;
  tag: string;
  id?: string;
  classes?: string[];
  role?: string;
  /** Accessible name (aria-label, label, alt, title, text content). */
  name?: string;
  text?: string;
  attrs?: Record<string, string>;
  rect?: { x: number; y: number; w: number; h: number };
  /** Ancestor chain from top to bottom, e.g. ["main", "form#login", "button.primary"]. */
  path?: string[];
  /** Truncated outerHTML - text, not a screenshot. */
  html?: string;
  /** Exact element under the cursor, if `selector` points to an ancestor. */
  leaf?: string;
}

export type QaEventType =
  | "click"
  | "dblclick"
  | "contextmenu"
  | "hover"
  | "input"
  | "change"
  | "key"
  | "scroll"
  | "navigate"
  | "resize"
  | "select"
  | "console"
  | "network"
  | "submit"
  | "note"
  | "marker";

/** Summary of what changed in the DOM after an interaction. */
export interface DomEffect {
  urlChanged?: { from: string; to: string };
  added?: number;
  removed?: number;
  dialogOpened?: boolean;
  alert?: string;
  /** Newly appeared visible text (truncated). */
  newText?: string;
  /** Changed attributes on existing elements. */
  attrChanges?: Array<{ selector: string; attr: string; value: string | null }>;
}

export interface QaEvent {
  id: string;
  /** Milliseconds since the start of the recording. */
  t: number;
  /** Absolute timestamp (epoch ms). */
  ts: number;
  type: QaEventType;
  /** URL of the page at the time of the event. */
  url: string;
  target?: ElementRef;
  detail?: Record<string, unknown>;
  effect?: DomEffect;
  /** Spoken text from this event's time window - see correlate.ts. */
  spokenContext?: string[];
}

/** Coarsely sampled cursor path - for replay, keeps the event log semantic. */
export interface CursorSample {
  t: number;
  x: number;
  y: number;
}

export interface TranscriptSegment {
  t: number;
  endT: number;
  text: string;
  final: boolean;
}

export interface QaSessionMeta {
  id: string;
  title: string;
  startedAt: string;
  endedAt?: string;
  durationMs: number;
  mode: QaMode;
  initialUrl: string;
  viewport: { width: number; height: number; dpr: number };
  userAgent: string;
  language: string;
  /** Where the transcript came from. */
  transcriptSource?: "webspeech" | "whisper" | "openai" | "openai-live" | "soniox-live" | "none";
  /** Model, if transcribed locally with Whisper or via OpenAI. */
  transcriptModel?: string;
  /** Environment (e.g. "Staging") the recording was made in - extension only. */
  environment?: {
    name: string;
    notes?: string;
    /** Secret values are already masked here. */
    variables?: Array<{ key: string; value: string }>;
  };
}

export interface QaSession {
  version: "qa-recording/1";
  meta: QaSessionMeta;
  events: QaEvent[];
  cursor: CursorSample[];
  transcript: TranscriptSegment[];
  audio?: { mimeType: string; durationMs: number; fileName: string };
}

/** Event as emitted by the recorder - time as epoch ms, converted to recording time on load. */
export interface RawFrameEvent {
  id: string;
  ts: number;
  type: QaEventType;
  url: string;
  target?: ElementRef;
  detail?: Record<string, unknown>;
}

/** Message studio -> recorder. */
export type ControlMessage =
  | { source: "qa-studio"; type: "start" }
  | { source: "qa-studio"; type: "stop" }
  | { source: "qa-studio"; type: "config"; config: RecorderConfig }
  | { source: "qa-studio"; type: "highlight"; selector: string | null };

export interface RecorderConfig {
  /** Draw an overlay around the currently targeted element. */
  highlight: boolean;
  /** Minimum dwell time in ms before a hover is logged. */
  hoverDwellMs: number;
  /** Record the target's outerHTML (truncated). */
  captureHtml: boolean;
  /** Record input values (password fields always stay masked). */
  captureInputValues: boolean;
  /** Record console.error/warn of the target page. */
  captureConsole: boolean;
  /** Record failed requests (>=400). */
  captureNetwork: boolean;
}

export const DEFAULT_RECORDER_CONFIG: RecorderConfig = {
  highlight: true,
  hoverDwellMs: 400,
  captureHtml: true,
  captureInputValues: true,
  captureConsole: true,
  captureNetwork: true,
};
