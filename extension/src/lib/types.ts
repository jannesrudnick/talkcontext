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
  RawFrameEvent,
  RecorderConfig,
  TranscriptSegment,
} from "@shared/types";

export type { CursorSample, DomEffect, RawFrameEvent, RecorderConfig, TranscriptSegment };

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
  };
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
  };
  audio?: {
    mimeType: string;
    /** epoch ms, zu dem die Tonspur beginnt. */
    startedAt: number;
    durationMs: number;
    size: number;
  };
  audioError?: string;
  transcript?: {
    source: "whisper" | "openai";
    model: string;
    /** Zeiten relativ zum Beginn der Tonspur. */
    segments: TranscriptSegment[];
    createdAt: number;
  };
}

/* ------------------------------------------------------------ Laufzeit */

export type AudioState = "off" | "starting" | "on" | "denied" | "error";

export interface ActiveRecording {
  recordingId: string;
  tabId: number;
  startedAt: number;
  audio: AudioState;
  audioError?: string;
  stopping?: boolean;
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
