/**
 * Transcription of the audio track - locally with Whisper (web worker), via OpenAI or Soniox.
 *
 * OpenAI needs no pass-through endpoint: extension pages with host
 * permission are not subject to CORS restrictions.
 */
import type { TranscriptSegment, WhisperModelId } from "@/lib/types";
import { listSonioxModels, SONIOX_ASYNC_FALLBACK_MODEL } from "./soniox";
import type { WhisperRequest, WhisperResponse } from "./whisper.worker";

export const WHISPER_MODELS: Array<{ id: WhisperModelId; label: string; size: string }> = [
  { id: "onnx-community/whisper-tiny", label: "Tiny", size: "96 MB" },
  { id: "onnx-community/whisper-base", label: "Base", size: "146 MB" },
  { id: "onnx-community/whisper-small", label: "Small", size: "325 MB" },
];

export interface TranscriptionProgress {
  ratio: number;
  label: string;
}

/** Decode an audio blob to 16 kHz mono - the format Whisper expects. */
async function decodeTo16kMono(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0).slice();
    const left = decoded.getChannelData(0);
    const right = decoded.getChannelData(1);
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i += 1) mono[i] = (left[i]! + right[i]!) / 2;
    return mono;
  } finally {
    void context.close();
  }
}

let worker: Worker | null = null;

export async function transcribeWithWhisper(
  audio: Blob,
  model: WhisperModelId,
  language: string,
  onProgress: (progress: TranscriptionProgress) => void,
): Promise<TranscriptSegment[]> {
  onProgress({ ratio: 0, label: "Preparing audio" });
  const samples = await decodeTo16kMono(audio);

  worker ??= new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  const active = worker;
  const files = new Map<string, { loaded: number; total: number }>();

  return new Promise<TranscriptSegment[]>((resolve, reject) => {
    const onMessage = (event: MessageEvent<WhisperResponse>) => {
      const data = event.data;
      if (data.type === "status") {
        onProgress({
          ratio: data.stage === "run" ? 1 : 0,
          label: data.stage === "run" ? "Transcribing …" : "Loading model",
        });
      } else if (data.type === "progress") {
        files.set(data.file, { loaded: data.loaded, total: data.total });
        let loaded = 0;
        let total = 0;
        for (const entry of files.values()) {
          loaded += entry.loaded;
          total += entry.total;
        }
        onProgress({
          ratio: total > 0 ? loaded / total : 0,
          label: `Loading model (${Math.round(loaded / 1e6)} / ${Math.round(total / 1e6)} MB)`,
        });
      } else if (data.type === "error") {
        active.removeEventListener("message", onMessage);
        reject(new Error(data.message));
      } else if (data.type === "done") {
        active.removeEventListener("message", onMessage);
        resolve(
          data.chunks.map((chunk) => ({
            t: Math.round(chunk.start * 1000),
            endT: Math.round(chunk.end * 1000),
            text: chunk.text,
            final: true,
          })),
        );
      }
    };
    active.addEventListener("message", onMessage);
    const request: WhisperRequest = { type: "transcribe", model, language, audio: samples };
    active.postMessage(request, [samples.buffer as ArrayBuffer]);
  });
}

const MAX_OPENAI_BYTES = 25 * 1024 * 1024;

export async function transcribeWithOpenAi(audio: Blob, apiKey: string, language: string): Promise<TranscriptSegment[]> {
  if (!apiKey.trim()) throw new Error("No OpenAI API key configured (Settings → Transcription).");
  if (audio.size > MAX_OPENAI_BYTES) {
    throw new Error(`Audio too large (${Math.round(audio.size / 1e6)} MB) – OpenAI allows at most 25 MB.`);
  }
  const form = new FormData();
  form.set("file", audio, "audio.webm");
  form.set("model", "whisper-1");
  form.set("response_format", "verbose_json");
  form.set("language", language.split("-")[0] ?? "en");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
    body: form,
  });
  if (!response.ok) {
    let message = `OpenAI responded with status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  const data = (await response.json()) as { segments?: Array<{ start: number; end: number; text: string }> };
  return (data.segments ?? []).map((segment) => ({
    t: Math.round(segment.start * 1000),
    endT: Math.round(segment.end * 1000),
    text: segment.text.trim(),
    final: true,
  }));
}

/* ---------------------------------------------------------------- Soniox */

const SONIOX_API = "https://api.soniox.com/v1";
/** Same as the live transcript: a pause this long starts a new segment. */
const SONIOX_GAP_MS = 1500;

interface SonioxToken {
  text: string;
  start_ms?: number;
  end_ms?: number;
}

/** Tokens -> segments: split on pauses and sentence ends. Exported for testing. */
export function sonioxSegments(tokens: SonioxToken[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: TranscriptSegment | null = null;
  for (const token of tokens) {
    if (token.start_ms == null || token.end_ms == null || token.text.startsWith("<")) continue;
    if (current && token.start_ms - current.endT > SONIOX_GAP_MS) {
      segments.push(current);
      current = null;
    }
    current ??= { t: token.start_ms, endT: token.end_ms, text: "", final: true };
    current.text += token.text;
    current.endT = token.end_ms;
    if (/[.?!]$/.test(token.text) && current.endT - current.t > 2000) {
      segments.push(current);
      current = null;
    }
  }
  if (current) segments.push(current);
  return segments.map((segment) => ({ ...segment, text: segment.text.trim() })).filter((segment) => segment.text);
}

/**
 * Soniox async API: upload the audio track, create a transcription, poll,
 * fetch tokens. Upload and job are deleted afterwards (best effort).
 */
export async function transcribeWithSoniox(
  audio: Blob,
  apiKey: string,
  language: string,
  onProgress: (progress: TranscriptionProgress) => void,
): Promise<{ segments: TranscriptSegment[]; model: string }> {
  const key = apiKey.trim();
  if (!key) throw new Error("No Soniox API key configured (Settings → Transcription).");
  const auth = { Authorization: `Bearer ${key}` };
  const call = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${SONIOX_API}${path}`, { ...init, headers: { ...auth, ...init.headers } });
    if (!response.ok) {
      let message = `Soniox responded with status ${response.status}`;
      try {
        const body = (await response.json()) as { message?: string; error_message?: string };
        message = body.message ?? body.error_message ?? message;
      } catch {
        /* not JSON */
      }
      throw new Error(message);
    }
    return (await response.json()) as T;
  };
  const remove = (path: string) => void fetch(`${SONIOX_API}${path}`, { method: "DELETE", headers: auth }).catch(() => undefined);

  onProgress({ ratio: 0.05, label: "Uploading audio to Soniox" });
  const model = await listSonioxModels(key, "async").then((models) => models[0] ?? SONIOX_ASYNC_FALLBACK_MODEL, () => SONIOX_ASYNC_FALLBACK_MODEL);
  const form = new FormData();
  form.set("file", audio, "audio.webm");
  const file = await call<{ id: string }>("/files", { method: "POST", body: form });
  let jobId: string | null = null;
  try {
    const job = await call<{ id: string }>("/transcriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, file_id: file.id, language_hints: [language.split("-")[0] ?? "en"] }),
    });
    jobId = job.id;
    for (;;) {
      const state = await call<{ status: "queued" | "processing" | "completed" | "error"; error_message?: string | null }>(
        `/transcriptions/${job.id}`,
      );
      if (state.status === "completed") break;
      if (state.status === "error") throw new Error(state.error_message ?? "Soniox could not transcribe the audio.");
      onProgress({ ratio: state.status === "queued" ? 0.3 : 0.6, label: state.status === "queued" ? "Queued at Soniox" : "Transcribing at Soniox …" });
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    onProgress({ ratio: 0.95, label: "Fetching transcript" });
    const transcript = await call<{ tokens: SonioxToken[] }>(`/transcriptions/${job.id}/transcript`);
    return { segments: sonioxSegments(transcript.tokens), model };
  } finally {
    // The file must stay until the job is done - so clean up only here.
    if (jobId) remove(`/transcriptions/${jobId}`);
    remove(`/files/${file.id}`);
  }
}
