/**
 * Datenmodell der Extension.
 *
 * Das semantische Protokoll (QaEvent, ElementRef, ...) kommt unveraendert aus
 * der Next-App (`@shared`), damit Markdown-/JSON-Export identisch bleiben.
 * Neu ist das Session-Replay (rrweb) sowie Konsole und Netzwerk als eigene Spuren.
 */
import type {
  CursorSample,
  DomEffect,
  ElementRef,
  RawFrameEvent,
  RecorderConfig,
  TranscriptSegment,
} from "@shared/types";

export type { CursorSample, DomEffect, ElementRef, RawFrameEvent, RecorderConfig, TranscriptSegment };

/* ------------------------------------------------------------ Einstellungen */

export interface EnvVariable {
  id: string;
  key: string;
  value: string;
  /** Wird im Export maskiert und in der Oberflaeche verdeckt angezeigt. */
  secret: boolean;
}

export interface Environment {
  id: string;
  name: string;
  /** Tailwind-unabhaengiger Farbwert fuer Badge und Overlay. */
  color: string;
  /**
   * URL-Muster, z.B. `http://localhost:3000/*` oder `https://*.staging.example.com/*`.
   * `*` steht fuer beliebig viele Zeichen.
   */
  patterns: string[];
  /** Freitext fuer den Agenten: Testnutzer, Feature-Flags, Besonderheiten. */
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
  /** Alle Eingabefelder im Replay maskieren (Passwoerter sind es immer). */
  maskAllInputs: boolean;
  /** Canvas-Inhalte mitschneiden - teuer, deshalb standardmaessig aus. */
  recordCanvas: boolean;
  /** Zusaetzliche CSS-Selektoren, die im Replay ausgeblendet werden. */
  blockSelector: string;
}

export interface FeedbackConfig {
  /** Rechtsklick auf ein Element startet einen Feedback-Punkt (Alt+Rechtsklick = normales Menue). */
  contextMenu: boolean;
  /** Bei Konsolen-/Netzwerkfehlern automatisch einen Screenshot machen. */
  screenshotOnError: boolean;
  /** Farbe des Stifts. */
  penColor: string;
}

export interface HandoffConfig {
  /** Lokaler qey-MCP-Server, an den Aufnahmen fuer Claude Code geschickt werden. */
  endpoint: string;
  /** Nach dem Stoppen (und ggf. Transkribieren) automatisch senden. */
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
    /** Direkt nach dem Stoppen transkribieren (beim Oeffnen der Aufnahme). */
    auto: boolean;
    /** Live-Transkript waehrend der Aufnahme ueber OpenAI Realtime. */
    live: boolean;
    /** Modell fuer das Live-Transkript. */
    liveModel: string;
  };
  feedback: FeedbackConfig;
  handoff: HandoffConfig;
  /** Nach dem Stoppen die Aufnahme in einem neuen Tab oeffnen. */
  openAfterStop: boolean;
  environments: Environment[];
}

/* ------------------------------------------------------------- Aufnahme */

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
  /** Nur bei fehlgeschlagenen Requests, gekuerzt und mit maskierten Geheimnissen. */
  requestBody?: string;
  responseBody?: string;
}

/* --------------------------------------------------------- Feedback */

/** Komponenten-Herkunft eines Elements (React/Vue Dev-Builds). */
export interface ComponentInfo {
  framework: "react" | "vue";
  /** Von aussen nach innen, z.B. ["CheckoutPage", "CheckoutForm", "SubmitButton"]. */
  chain: string[];
  /** Quelldatei, falls der Dev-Build sie verraet (Vue `__file`, React `_debugSource`). */
  file?: string;
}

/** Ein Strich mit dem Stift - Koordinaten relativ zum Viewport beim Zeichnen. */
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
 * Ein ausdruecklicher Befund: angelegt per Rechtsklick, Stift, Notiz oder Marker.
 * Ersetzt das Raten ueber Zeitfenster - alles, was waehrend `activeFrom..activeTo`
 * gesagt wird, gehoert zu diesem Punkt.
 */
export interface FeedbackItem {
  id: string;
  /** Laufende Nummer innerhalb der Aufnahme (F1, F2, ...). */
  index: number;
  source: "contextmenu" | "pen" | "note" | "marker";
  url: string;
  pageTitle: string;
  activeFrom: number;
  activeTo?: number;
  target?: ElementRef;
  component?: ComponentInfo;
  /** Ausgewaehlte berechnete Styles des Elements - fuer Layout-Feedback. */
  styles?: Record<string, string>;
  /** Gekuerzter DOM-Ausschnitt um das Element zum Zeitpunkt des Feedbacks. */
  dom?: string;
  /** Getippter Text. */
  text: string;
  /** Live mitgeschriebene Sprache (finale Abschnitte). */
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

/** Die Spuren einer Aufnahme - jede wird in Stuecken (Chunks) gespeichert. */
export interface ChunkPayloads {
  /** rrweb `eventWithTime` - bewusst `unknown`, rrweb-Typen bleiben im Replay. */
  rrweb: unknown[];
  events: RawFrameEvent[];
  effects: Array<{ id: string; effect: DomEffect }>;
  cursor: Array<{ ts: number; x: number; y: number }>;
  console: ConsoleEntry[];
  network: NetworkEntry[];
  audio: Blob[];
  /** Upserts - der letzte Stand pro ID gewinnt. */
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
  /** Zuletzt an den qey-MCP-Server geschickt. */
  sentAt?: number;
  audio?: {
    mimeType: string;
    /** epoch ms, zu dem die Tonspur beginnt. */
    startedAt: number;
    durationMs: number;
    size: number;
  };
  audioError?: string;
  transcript?: {
    source: "whisper" | "openai" | "openai-live";
    model: string;
    /** Zeiten relativ zum Beginn der Tonspur. */
    segments: TranscriptSegment[];
    createdAt: number;
  };
}

/* ------------------------------------------------------------ Laufzeit */

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
  /** Naechste Feedback-Nummer - ueberlebt Seitenwechsel. */
  nextFeedbackIndex: number;
}

/** Was das Overlay fuer seinen Tab wissen muss. */
export interface TabState {
  overlayVisible: boolean;
  recording: ActiveRecording | null;
  /** Laeuft gerade eine Aufnahme in einem anderen Tab? */
  busyElsewhere: boolean;
  environment: Environment | null;
  settings: Settings;
}
