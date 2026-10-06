import { buildJson, buildMarkdown, downloadFile, sessionFileBase } from "@/lib/qa/export";
import type { LoadedRecording } from "./load";
import { toQaSession } from "./load";

export function recordingMarkdown(recording: LoadedRecording): string {
  return buildMarkdown(toQaSession(recording));
}

export function exportMarkdown(recording: LoadedRecording) {
  const session = toQaSession(recording);
  downloadFile(`${sessionFileBase(session)}.md`, buildMarkdown(session), "text/markdown");
}

export function exportJson(recording: LoadedRecording) {
  const session = toQaSession(recording);
  downloadFile(`${sessionFileBase(session)}.json`, buildJson(session), "application/json");
}

/** Full replay incl. console/network - for sharing or archiving. */
export function exportReplay(recording: LoadedRecording) {
  const session = toQaSession(recording);
  const payload = {
    version: "qey-replay/1",
    meta: recording.meta,
    rrweb: recording.rrweb,
    console: recording.console,
    network: recording.network,
    session,
  };
  downloadFile(`${sessionFileBase(session)}.replay.json`, JSON.stringify(payload), "application/json");
}

export function exportAudio(recording: LoadedRecording) {
  if (!recording.audio) return;
  const session = toQaSession(recording);
  downloadFile(`${sessionFileBase(session)}.webm`, recording.audio, recording.audio.type || "audio/webm");
}
