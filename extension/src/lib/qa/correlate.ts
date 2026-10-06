/**
 * Assigns spoken transcript segments to the DOM events during which they were
 * said. Events and transcript already share a clock (`t` = ms since the start
 * of the recording), but merely sorting by `t` says nothing about whether a
 * sentence belongs to a hover, a click or just the next pause - for that,
 * every event needs a time window instead of a point.
 */
import type { QaEvent, TranscriptSegment } from "./types";

export interface CorrelatedEvent extends QaEvent {
  /** Spoken text that belongs to this event in time - chronological. */
  spokenContext?: string[];
}

export interface CorrelationResult {
  events: CorrelatedEvent[];
  /** Speech outside every event window - pauses, thinking aloud. */
  unmatched: TranscriptSegment[];
}

export interface CorrelationInput {
  events: QaEvent[];
  transcript: TranscriptSegment[];
  meta: { durationMs: number };
}

// Point events (click etc.) are often announced beforehand ("I'm clicking it
// now") and rarely commented on afterwards - so the window is asymmetric.
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
  /** Anchor time for the distance calculation on ambiguous overlap. */
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
  // Recording ended while still hovering - keep the window open until the end of the recording.
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

    // If the sentence lies entirely within a hover dwell, the hover wins - that is
    // the active context, even if a click window happens to overlap.
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
