/**
 * Ordnet gesprochene Transkript-Segmente den DOM-Events zu, waehrend derer sie
 * gefallen sind. Events und Transkript teilen schon eine Uhr (`t` = ms seit
 * Aufnahmestart), aber ein reines Sortieren nach `t` sagt nichts darueber, ob
 * ein Satz zu einem Hover, einem Klick oder einfach zur naechsten Pause
 * gehoert - dafuer braucht jedes Event ein Zeitfenster statt eines Punkts.
 */
import type { QaEvent, TranscriptSegment } from "./types";

export interface CorrelatedEvent extends QaEvent {
  /** Gesprochener Text, der zeitlich zu diesem Event gehoert - chronologisch. */
  spokenContext?: string[];
}

export interface CorrelationResult {
  events: CorrelatedEvent[];
  /** Sprache ausserhalb jedes Event-Fensters - Pausen, freies Nachdenken. */
  unmatched: TranscriptSegment[];
}

export interface CorrelationInput {
  events: QaEvent[];
  transcript: TranscriptSegment[];
  meta: { durationMs: number };
}

// Bei Punkt-Events (Klick etc.) wird oft vorher angekuendigt ("ich klick jetzt
// drauf") und selten hinterher noch kommentiert - Fenster ist deshalb asymmetrisch.
const POINT_LOOKBACK_MS = 1500;
const POINT_LOOKAHEAD_MS = 500;

const POINT_EVENT_TYPES = new Set<QaEvent["type"]>([
  "click",
  "dblclick",
  "contextmenu",
  "input",
  "change",
  "key",
  "submit",
  "select",
]);

interface Window {
  eventId: string;
  kind: "hover" | "point";
  start: number;
  end: number;
  /** Ankerzeit fuer die Distanzberechnung bei mehrdeutiger Ueberlappung. */
  refT: number;
}

export function correlate(input: CorrelationInput): CorrelationResult {
  const byId = new Map<string, CorrelatedEvent>();
  for (const event of input.events) byId.set(event.id, { ...event });

  const windows: Window[] = [];
  let pendingHoverStart: QaEvent | null = null;

  for (const event of input.events) {
    if (event.type === "hover" && event.detail?.phase === "start") {
      pendingHoverStart = event;
      continue;
    }
    if (event.type === "hover" && event.detail?.phase === "end") {
      if (pendingHoverStart) {
        windows.push({
          eventId: pendingHoverStart.id,
          kind: "hover",
          start: pendingHoverStart.t,
          end: event.t,
          refT: pendingHoverStart.t,
        });
        pendingHoverStart = null;
      }
      continue;
    }
    if (POINT_EVENT_TYPES.has(event.type)) {
      windows.push({
        eventId: event.id,
        kind: "point",
        start: event.t - POINT_LOOKBACK_MS,
        end: event.t + POINT_LOOKAHEAD_MS,
        refT: event.t,
      });
    }
  }
  // Aufnahme endete, waehrend noch gehovert wurde - Fenster bis Aufnahmeende offen lassen.
  if (pendingHoverStart) {
    windows.push({
      eventId: pendingHoverStart.id,
      kind: "hover",
      start: pendingHoverStart.t,
      end: input.meta.durationMs,
      refT: pendingHoverStart.t,
    });
  }

  const unmatched: TranscriptSegment[] = [];

  for (const segment of input.transcript) {
    if (!segment.final || !segment.text.trim()) continue;
    const segStart = segment.t;
    const segEnd = Math.max(segment.endT, segment.t);
    const segMid = (segStart + segEnd) / 2;

    const overlapping = windows.filter((w) => segEnd >= w.start && segStart <= w.end);
    if (!overlapping.length) {
      unmatched.push(segment);
      continue;
    }

    // Liegt der Satz komplett in einem Hover-Dwell, gewinnt der Hover - das ist
    // der aktive Kontext, auch wenn zufaellig ein Klick-Fenster ueberlappt.
    const containingHovers = overlapping.filter((w) => w.kind === "hover" && segStart >= w.start && segEnd <= w.end);
    const candidates = containingHovers.length ? containingHovers : overlapping;
    const pick = candidates.reduce((best, w) =>
      Math.abs(segMid - w.refT) < Math.abs(segMid - best.refT) ? w : best,
    );

    const target = byId.get(pick.eventId);
    if (!target) {
      unmatched.push(segment);
      continue;
    }
    (target.spokenContext ??= []).push(segment.text.trim());
  }

  return {
    events: input.events.map((event) => byId.get(event.id) ?? event),
    unmatched,
  };
}
