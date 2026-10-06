/**
 * Offscreen document: records the microphone while a recording is running.
 *
 * The service worker has no `getUserMedia`, and in the content script the
 * permission would be requested for the *target page*. Here it applies to the
 * extension's origin - granted once in the settings, Chrome never asks again.
 *
 * The audio track is written to IndexedDB every second.
 */
import { appendChunk } from "@/lib/db";
import type { OffscreenEvent, OffscreenRequest } from "@/lib/messages";
import { LiveTranscriber } from "./live-transcriber";

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let levelTimer: number | undefined;
let currentId: string | null = null;
let startedAt = 0;
let size = 0;
let writes: Promise<unknown> = Promise.resolve();
let live: LiveTranscriber | null = null;

const send = (event: OffscreenEvent) => browser.runtime.sendMessage(event).catch(() => undefined);

function pickMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function startLevelMeter(source: MediaStream) {
  audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  audioContext.createMediaStreamSource(source).connect(analyser);
  const buffer = new Uint8Array(analyser.fftSize);
  levelTimer = window.setInterval(() => {
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (const value of buffer) {
      const centered = (value - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / buffer.length);
    void send({ type: "talkcontext:audio-level", level: Math.min(1, rms * 4) });
  }, 150);
}

async function start(recordingId: string, liveConfig: Extract<OffscreenRequest, { type: "start-audio" }>["live"]) {
  if (recorder) return;
  currentId = recordingId;
  size = 0;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
    void send({
      type: "talkcontext:audio-error",
      recordingId,
      denied,
      message: denied
        ? "Microphone access not granted for TalkContext. Allow it in Settings under Recording."
        : error instanceof Error
          ? error.message
          : String(error),
    });
    return;
  }

  const mimeType = pickMimeType();
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recorder.addEventListener("dataavailable", (event) => {
    if (!event.data.size || !currentId) return;
    size += event.data.size;
    const id = currentId;
    writes = writes.then(() => appendChunk(id, "audio", [event.data])).catch(() => undefined);
  });
  recorder.start(1000);
  startedAt = Date.now();
  startLevelMeter(stream);
  void send({ type: "talkcontext:audio-started", recordingId, startedAt, mimeType: recorder.mimeType || "audio/webm" });

  if (liveConfig) {
    live = new LiveTranscriber({
      ...liveConfig,
      onText: (event) => void send({ type: "talkcontext:live-text", recordingId, event }),
      onState: (state, error) => void send({ type: "talkcontext:live-status", recordingId, state, error }),
    });
    live.start(stream).catch((error: unknown) => {
      void send({
        type: "talkcontext:live-status",
        recordingId,
        state: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

async function stop() {
  const id = currentId;
  if (!recorder || !id) return;
  const stopped = new Promise<void>((resolve) => recorder!.addEventListener("stop", () => resolve(), { once: true }));
  await live?.stop();
  live = null;
  recorder.stop();
  await stopped;
  await writes;
  window.clearInterval(levelTimer);
  stream?.getTracks().forEach((track) => track.stop());
  await audioContext?.close().catch(() => undefined);
  recorder = null;
  stream = null;
  audioContext = null;
  currentId = null;
  void send({ type: "talkcontext:audio-stopped", recordingId: id, durationMs: Date.now() - startedAt, size });
}

browser.runtime.onMessage.addListener((message: OffscreenRequest) => {
  if (message?.target !== "offscreen") return undefined;
  if (message.type === "start-audio") void start(message.recordingId, message.live);
  if (message.type === "stop-audio") void stop();
  return undefined;
});
