/**
 * Data model of the extension.
 *
 * The semantic log (QaEvent, ElementRef, ...) and its Markdown/JSON export
 * live in `lib/qa`; on top of that come the session replay (rrweb) plus
 * console and network as separate tracks.
 */
import type {
  CursorSample,
  DomEffect,
  ElementRef,
  RawFrameEvent,
  RecorderConfig,
  TranscriptSegment,
} from "@/lib/qa/types";

export type { CursorSample, DomEffect, ElementRef, RawFrameEvent, RecorderConfig, TranscriptSegment };

/* ------------------------------------------------------------ Settings */

export interface EnvVariable {
  id: string;
  key: string;
  value: string;
  /** Masked in the export and hidden in the UI. */
  secret: boolean;
}

export interface Environment {
  id: string;
  name: string;
  /** Tailwind-independent color value for badge and overlay. */
  color: string;
  /**
   * URL patterns, e.g. `http://localhost:3000/*` or `https://*.staging.example.com/*`.
   * `*` matches any number of characters.
   */
  patterns: string[];
  /** Free text for the agent: test users, feature flags, quirks. */
  notes: string;
  variables: EnvVariable[];
}

export type WhisperModelId =
  | "onnx-community/whisper-tiny"
  | "onnx-community/whisper-base"
  | "onnx-community/whisper-small";

export type TranscriptionEngine = "none" | "whisper" | "openai";

export type ThemePreference = "system" | "light" | "dark";

export interface ReplayConfig {
  /** Mask all input fields in the replay (passwords always are). */
  maskAllInputs: boolean;
  /** Record canvas contents - expensive, so off by default. */
  recordCanvas: boolean;
  /** Additional CSS selectors that are hidden in the replay. */
  blockSelector: string;
}

export interface FeedbackConfig {
  /** Right-clicking an element starts a feedback point (Alt+right-click = normal menu). */
  contextMenu: boolean;
  /** Automatically take a screenshot on console/network errors. */
  screenshotOnError: boolean;
  /** Pen color. */
  penColor: string;
}

export interface HandoffConfig {
  /** Local TalkContext MCP server that recordings are sent to for Claude Code. */
  endpoint: string;
  /** Send automatically after stopping (and transcribing, if enabled). */
  autoSend: boolean;
}

export interface Settings {
  language: string;
  theme: ThemePreference;
  recorder: RecorderConfig;
  replay: ReplayConfig;
  audio: { enabled: boolean };
  transcription: {
    engine: TranscriptionEngine;
    whisperModel: WhisperModelId;
    openaiKey: string;
    /** Transcribe right after stopping (when the recording is opened). */
    auto: boolean;
    /** Live transcript during the recording via OpenAI Realtime. */
    live: boolean;
    /** Provider for the live transcript. */
    liveProvider: "openai" | "soniox";
    /** OpenAI model for the live transcript. */
    liveModel: string;
    sonioxKey: string;
    /** Soniox real-time model id, or "latest" = newest available at recording start. */
    sonioxModel: string;
  };
  feedback: FeedbackConfig;
  handoff: HandoffConfig;
  /** Open the recording in a new tab after stopping. */
  openAfterStop: boolean;
  environments: Environment[];
}

/* ------------------------------------------------------------- Recording */

export interface ConsoleEntry {
  id: string;
  ts: number;
  level: "log" | "info" | "warn" | "error" | "debug";
  message: string;
  source?: string;
  stack?: string;
}

export interface NetworkEntry {
  id: string;
  ts: number;
  kind: "fetch" | "xhr";
  method: string;
  url: string;
  status: number;
  durationMs: number;
  error?: string;
  /** Only for failed requests, truncated and with secrets masked. */
  requestBody?: string;
  responseBody?: string;
}

/* --------------------------------------------------------- Feedback */

/** Component origin of an element (React/Vue dev builds). */
export interface ComponentInfo {
  framework: "react" | "vue";
  /** Outermost to innermost, e.g. ["CheckoutPage", "CheckoutForm", "SubmitButton"]. */
  chain: string[];
  /** Source file, if the dev build exposes it (Vue `__file`, React `_debugSource`). */
  file?: string;
}

/** A pen stroke - coordinates relative to the viewport at drawing time. */
export interface Stroke {
  id: string;
  ts: number;
  feedbackId: string;
  color: string;
  width: number;
  points: Array<[number, number]>;
  viewport: { width: number; height: number };
  scroll: { x: number; y: number };
  url: string;
}

export interface Screenshot {
  id: string;
  ts: number;
  reason: "feedback" | "stroke" | "error" | "manual";
  feedbackId?: string;
  url: string;
  width: number;
  height: number;
  blob: Blob;
}

/**
 * An explicit finding: created via right-click, pen, note or marker.
 * Replaces guessing by time window - everything said during `activeFrom..activeTo`
 * belongs to this point.
 */
export interface FeedbackItem {
  id: string;
  /** Sequential number within the recording (F1, F2, ...). */
  index: number;
  source: "contextmenu" | "pen" | "note" | "marker";
  url: string;
  pageTitle: string;
  activeFrom: number;
  activeTo?: number;
  target?: ElementRef;
  component?: ComponentInfo;
  /** Selected computed styles of the element - for layout feedback. */
  styles?: Record<string, string>;
  /** Truncated DOM snippet around the element at the time of the feedback. */
  dom?: string;
  /** Typed text. */
  text: string;
  /** Live-transcribed speech (final segments). */
  speech: string[];
  screenshotIds: string[];
  strokeIds: string[];
  discarded?: boolean;
}

export interface LiveSegment {
  id: string;
  /** epoch ms */
  start: number;
  end: number;
  text: string;
}

/** The tracks of a recording - each is stored in chunks. */
export interface ChunkPayloads {
  /** rrweb `eventWithTime` - deliberately `unknown`, rrweb types stay in the replay. */
  rrweb: unknown[];
  events: RawFrameEvent[];
  effects: Array<{ id: string; effect: DomEffect }>;
  cursor: Array<{ ts: number; x: number; y: number }>;
  console: ConsoleEntry[];
  network: NetworkEntry[];
  audio: Blob[];
  /** Upserts - the latest state per ID wins. */
  feedback: FeedbackItem[];
  strokes: Stroke[];
  screenshots: Screenshot[];
  live: LiveSegment[];
}

export type ChunkKind = keyof ChunkPayloads;

export interface EnvironmentSnapshot {
  id: string;
  name: string;
  color: string;
  notes: string;
  variables: Array<{ key: string; value: string; secret: boolean }>;
}

export interface RecordingMeta {
  id: string;
  title: string;
  status: "recording" | "ready";
  /** epoch ms */
  startedAt: number;
  endedAt?: number;
  durationMs: number;
  initialUrl: string;
  lastUrl: string;
  pageTitle: string;
  environment?: EnvironmentSnapshot;
  viewport: { width: number; height: number; dpr: number };
  userAgent: string;
  language: string;
  counts: {
    events: number;
    clicks: number;
    errors: number;
    notes: number;
    pages: number;
    requests: number;
    feedback?: number;
    screenshots?: number;
  };
  /** Last sent to the TalkContext MCP server. */
  sentAt?: number;
  audio?: {
    mimeType: string;
    /** epoch ms at which the audio track starts. */
    startedAt: number;
    durationMs: number;
    size: number;
  };
  audioError?: string;
  transcript?: {
    source: "whisper" | "openai" | "openai-live" | "soniox-live";
    model: string;
    /** Times relative to the start of the audio track. */
    segments: TranscriptSegment[];
    createdAt: number;
  };
}

/* ------------------------------------------------------------ Runtime */

export type AudioState = "off" | "starting" | "on" | "denied" | "error";

export type LiveState = "off" | "connecting" | "on" | "error";

export interface ActiveRecording {
  recordingId: string;
  tabId: number;
  startedAt: number;
  audio: AudioState;
  audioError?: string;
  live: LiveState;
  liveError?: string;
  stopping?: boolean;
  /** Next feedback number - survives page navigations. */
  nextFeedbackIndex: number;
}

/** What the overlay needs to know for its tab. */
export interface TabState {
  overlayVisible: boolean;
  recording: ActiveRecording | null;
  /** Is a recording currently running in another tab? */
  busyElsewhere: boolean;
  environment: Environment | null;
  settings: Settings;
}
