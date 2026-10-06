/**
 * Loads a recording from IndexedDB and puts all tracks on one timeline.
 *
 * The UI's time base is the first rrweb frame (= replay time 0). For export,
 * times are converted to the recording start (the `qa-recording/1` format).
 */
import type { eventWithTime } from "rrweb";
import { correlate } from "@/lib/qa/correlate";
import type { QaEvent, QaSession, TranscriptSegment } from "@/lib/qa/types";
import { getRecording, readAudio, readLatestById, readTrack } from "@/lib/db";
import type { ConsoleEntry, FeedbackItem, NetworkEntry, RecordingMeta, Screenshot, Stroke } from "@/lib/types";

export interface LoadedRecording {
  meta: RecordingMeta;
  rrweb: eventWithTime[];
  /** Semantic events, `t` relative to replay time 0. */
  events: QaEvent[];
  console: ConsoleEntry[];
  network: NetworkEntry[];
  cursor: Array<{ ts: number; x: number; y: number }>;
  audio: Blob | null;
  /** Explicit findings, sorted by number (discarded ones omitted). */
  feedback: FeedbackItem[];
  strokes: Stroke[];
  screenshots: Screenshot[];
  /** epoch ms of replay time 0. */
  base: number;
  durationMs: number;
}

export async function loadRecording(id: string): Promise<LoadedRecording | null> {
  const meta = await getRecording(id);
  if (!meta) return null;

  const [rrwebRaw, rawEvents, effects, consoleEntries, network, cursor, audio, feedback, strokes, screenshots] = await Promise.all([
    readTrack(id, "rrweb"),
    readTrack(id, "events"),
    readTrack(id, "effects"),
    readTrack(id, "console"),
    readTrack(id, "network"),
    readTrack(id, "cursor"),
    meta.audio ? readAudio(id, meta.audio.mimeType) : Promise.resolve(null),
    readLatestById(id, "feedback"),
    readTrack(id, "strokes"),
    readTrack(id, "screenshots"),
  ]);

  const rrweb = (rrwebRaw as eventWithTime[]).slice().sort((a, b) => a.timestamp - b.timestamp);
  const base = rrweb[0]?.timestamp ?? meta.startedAt;
  const lastTs = Math.max(
    rrweb.at(-1)?.timestamp ?? 0,
    meta.endedAt ?? 0,
    rawEvents.at(-1)?.ts ?? 0,
  );

  const effectById = new Map(effects.map((entry) => [entry.id, entry.effect]));
  const events: QaEvent[] = rawEvents
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map((event) => ({
      ...event,
      t: Math.max(0, event.ts - base),
      effect: effectById.get(event.id),
    }));

  return {
    meta,
    rrweb,
    events,
    console: consoleEntries.slice().sort((a, b) => a.ts - b.ts),
    network: network.slice().sort((a, b) => a.ts - b.ts),
    cursor,
    audio,
    feedback: feedback
      .filter((item) => !item.discarded)
      .map((item) => ({ ...item, activeTo: item.activeTo ?? meta.endedAt ?? item.activeFrom }))
      .sort((a, b) => a.index - b.index),
    strokes: strokes.slice().sort((a, b) => a.ts - b.ts),
    screenshots: screenshots.slice().sort((a, b) => a.ts - b.ts),
    base,
    durationMs: Math.max(0, lastTs - base),
  };
}

/** Transcript segments in replay time (the audio track doesn't start exactly at 0). */
export function transcriptInReplayTime(recording: LoadedRecording): TranscriptSegment[] {
  const segments = recording.meta.transcript?.segments ?? [];
  const offset = recording.meta.audio ? recording.meta.audio.startedAt - recording.base : 0;
  return segments.map((segment) => ({ ...segment, t: segment.t + offset, endT: segment.endT + offset }));
}

/** Transcript segments in epoch ms. */
export function transcriptEpoch(recording: LoadedRecording): Array<{ start: number; end: number; text: string }> {
  const audioStart = recording.meta.audio?.startedAt ?? recording.meta.startedAt;
  return (recording.meta.transcript?.segments ?? [])
    .filter((segment) => segment.final && segment.text.trim())
    .map((segment) => ({ start: audioStart + segment.t, end: audioStart + Math.max(segment.endT, segment.t), text: segment.text.trim() }));
}

/**
 * What was said about which feedback point? Each segment goes to the point
 * whose active time (plus a short lead-in - people often announce before
 * they click) it overlaps most. Without a transcript, the live-captured
 * speech is kept.
 */
export function speechByFeedback(recording: LoadedRecording): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const segments = transcriptEpoch(recording);
  if (!segments.length) {
    for (const item of recording.feedback) result.set(item.id, item.speech);
    return result;
  }
  for (const segment of segments) {
    let best: FeedbackItem | null = null;
    let bestOverlap = 0;
    for (const item of recording.feedback) {
      const from = item.activeFrom - 1500;
      const to = (item.activeTo ?? item.activeFrom) + 800;
      const overlap = Math.min(to, segment.end) - Math.max(from, segment.start);
      if (overlap > bestOverlap) {
        best = item;
        bestOverlap = overlap;
      }
    }
    if (best) result.set(best.id, [...(result.get(best.id) ?? []), segment.text]);
  }
  return result;
}

/** Map the transcript to events - for the activity list. */
export function correlated(recording: LoadedRecording) {
  return correlate({
    events: recording.events,
    transcript: transcriptInReplayTime(recording),
    meta: { durationMs: recording.durationMs },
  });
}

/** Convert a recording to the `qa-recording/1` exchange format. */
export function toQaSession(recording: LoadedRecording): QaSession {
  const { meta } = recording;
  const start = meta.startedAt;
  const audioOffset = meta.audio ? meta.audio.startedAt - start : 0;
  return {
    version: "qa-recording/1",
    meta: {
      id: meta.id,
      title: meta.title,
      startedAt: new Date(start).toISOString(),
      endedAt: meta.endedAt ? new Date(meta.endedAt).toISOString() : undefined,
      durationMs: meta.durationMs,
      mode: "extension",
      initialUrl: meta.initialUrl,
      viewport: meta.viewport,
      userAgent: meta.userAgent,
      language: meta.language,
      transcriptSource: meta.transcript?.source ?? "none",
      transcriptModel: meta.transcript?.model,
      environment: meta.environment
        ? {
            name: meta.environment.name,
            notes: meta.environment.notes || undefined,
            variables: meta.environment.variables.map(({ key, value }) => ({ key, value })),
          }
        : undefined,
    },
    events: recording.events.map((event) => ({ ...event, t: Math.max(0, event.ts - start) })),
    cursor: recording.cursor.map((sample) => ({ t: sample.ts - start, x: sample.x, y: sample.y })),
    transcript: (meta.transcript?.segments ?? []).map((segment) => ({
      ...segment,
      t: segment.t + audioOffset,
      endT: segment.endT + audioOffset,
    })),
    audio: meta.audio
      ? { mimeType: meta.audio.mimeType, durationMs: meta.audio.durationMs, fileName: "audio.webm" }
      : undefined,
  };
}
