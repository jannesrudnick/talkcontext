/**
 * Datenmodell der QA-Aufnahme.
 *
 * Das Artefakt ist bewusst textuell/strukturiert statt ein Video: ein Agent soll
 * ohne Screenshot verstehen koennen, auf welchem DOM-Element die Maus stand,
 * was geklickt wurde und was der Nutzer dabei gesagt hat.
 */

export type QaMode = "proxy" | "bridge" | "extension";

/** Beschreibung eines DOM-Elements, robust genug zum Wiederfinden durch einen Agenten. */
export interface ElementRef {
  /** Bevorzugt data-testid / #id / [aria-label], sonst ein kurzer CSS-Pfad. */
  selector: string;
  xpath: string;
  tag: string;
  id?: string;
  classes?: string[];
  role?: string;
  /** Accessible Name (aria-label, label, alt, title, Textinhalt). */
  name?: string;
  text?: string;
  attrs?: Record<string, string>;
  rect?: { x: number; y: number; w: number; h: number };
  /** Vorfahrenkette von oben nach unten, z.B. ["main", "form#login", "button.primary"]. */
  path?: string[];
  /** Gekuerztes outerHTML - Text, kein Screenshot. */
  html?: string;
  /** Exaktes Element unter dem Cursor, falls `selector` auf einen Vorfahren zeigt. */
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

/** Zusammenfassung dessen, was sich nach einer Interaktion im DOM geaendert hat. */
export interface DomEffect {
  urlChanged?: { from: string; to: string };
  added?: number;
  removed?: number;
  dialogOpened?: boolean;
  alert?: string;
  /** Neu erschienener, sichtbarer Text (gekuerzt). */
  newText?: string;
  /** Geaenderte Attribute an bestehenden Elementen. */
  attrChanges?: Array<{ selector: string; attr: string; value: string | null }>;
}

export interface QaEvent {
  id: string;
  /** Millisekunden seit Aufnahmestart. */
  t: number;
  /** Absoluter Zeitstempel (epoch ms). */
  ts: number;
  type: QaEventType;
  /** Reale URL der Seite zum Zeitpunkt des Events (Proxy-URLs sind aufgeloest). */
  url: string;
  target?: ElementRef;
  detail?: Record<string, unknown>;
  effect?: DomEffect;
  /** Gesprochener Text aus dem Zeitfenster dieses Events - siehe correlate.ts. */
  spokenContext?: string[];
}

/** Grob abgetastete Cursorbahn - fuer Replay, haelt den Event-Log semantisch. */
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
  /** Woher das Transkript stammt. */
  transcriptSource?: "webspeech" | "whisper" | "openai" | "none";
  /** Modell, falls lokal mit Whisper oder ueber OpenAI transkribiert wurde. */
  transcriptModel?: string;
  /** Umgebung (z.B. "Staging"), in der aufgenommen wurde - nur Extension. */
  environment?: {
    name: string;
    notes?: string;
    /** Geheime Werte sind hier bereits maskiert. */
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

/** Nachricht Recorder -> Studio. */
export type FrameMessage =
  | { source: "qa-recorder"; type: "ready"; url: string; ts: number; mode: QaMode }
  | { source: "qa-recorder"; type: "events"; events: RawFrameEvent[] }
  | { source: "qa-recorder"; type: "cursor"; samples: Array<{ ts: number; x: number; y: number }> }
  | { source: "qa-recorder"; type: "effect"; id: string; effect: DomEffect }
  /** Anvisiertes Element ausserhalb einer laufenden Aufnahme - nur zur Anzeige. */
  | { source: "qa-recorder"; type: "preview"; target?: ElementRef };

/** Event wie es der Recorder schickt - Zeit als epoch ms, Studio rechnet um. */
export interface RawFrameEvent {
  id: string;
  ts: number;
  type: QaEventType;
  url: string;
  target?: ElementRef;
  detail?: Record<string, unknown>;
}

/** Nachricht Studio -> Recorder. */
export type ControlMessage =
  | { source: "qa-studio"; type: "start" }
  | { source: "qa-studio"; type: "stop" }
  | { source: "qa-studio"; type: "config"; config: RecorderConfig }
  | { source: "qa-studio"; type: "highlight"; selector: string | null };

export interface RecorderConfig {
  /** Overlay um das gerade anvisierte Element zeichnen. */
  highlight: boolean;
  /** Mindest-Verweildauer in ms, ab der ein Hover protokolliert wird. */
  hoverDwellMs: number;
  /** outerHTML des Ziels mitschneiden (gekuerzt). */
  captureHtml: boolean;
  /** Eingabewerte mitschneiden (Passwortfelder bleiben immer maskiert). */
  captureInputValues: boolean;
  /** console.error/warn der Zielseite mitschneiden. */
  captureConsole: boolean;
  /** Fehlgeschlagene Requests (>=400) mitschneiden. */
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
