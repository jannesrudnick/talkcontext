"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptSegment } from "@/lib/qa/types";
import type { WhisperModelId, WhisperRequest, WhisperResponse } from "@/lib/qa/whisper.worker";

export interface TranscriptionProgress {
  /** 0..1 across all model files. */
  ratio: number;
  label: string;
}

/** Sizes are the real download totals of the quantization used. */
export const WHISPER_MODELS: Array<{ id: WhisperModelId; label: string; size: string }> = [
  { id: "onnx-community/whisper-tiny", label: "Tiny", size: "96 MB" },
  { id: "onnx-community/whisper-base", label: "Base", size: "146 MB" },
  { id: "onnx-community/whisper-small", label: "Small", size: "325 MB" },
];

/** Decode an audio blob to 16 kHz mono - the format Whisper expects. */
async function decodeTo16kMono(blob: Blob): Promise<Float32Array> {
  const buffer = await blob.arrayBuffer();
  // Setting the target sample rate on the AudioContext makes the browser
  // resample while decoding.
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const decoded = await context.decodeAudioData(buffer);
    if (decoded.numberOfChannels === 1) return decoded.getChannelData(0).slice();
    // Average the channels instead of taking only the first.
    const left = decoded.getChannelData(0);
    const right = decoded.getChannelData(1);
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i += 1) mono[i] = (left[i] + right[i]) / 2;
    return mono;
  } finally {
    void context.close();
  }
}

/**
 * Transcribes the recorded audio track locally in the browser with Whisper.
 *
 * Compared to the Web Speech API: runs in any browser with WebGPU or WASM,
 * delivers real timestamps per segment and sends nothing to a server.
 */
export function useTranscription() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [device, setDevice] = useState<"webgpu" | "wasm" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const fileSizes = useRef(new Map<string, { loaded: number; total: number }>());

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const transcribe = useCallback(
    async (audio: Blob, model: WhisperModelId, language: string): Promise<TranscriptSegment[] | null> => {
      setError(null);
      setRunning(true);
      setProgress({ ratio: 0, label: "Preparing audio" });
      fileSizes.current.clear();

      let samples: Float32Array;
      try {
        samples = await decodeTo16kMono(audio);
      } catch (decodeError) {
        setError(decodeError instanceof Error ? decodeError.message : "Audio could not be decoded");
        setRunning(false);
        setProgress(null);
        return null;
      }

      const worker =
        workerRef.current ??
        new Worker(new URL("../lib/qa/whisper.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;

      return new Promise<TranscriptSegment[] | null>((resolve) => {
        const onMessage = (event: MessageEvent<WhisperResponse>) => {
          const data = event.data;
          if (data.type === "device") {
            setDevice(data.device);
            return;
          }
          if (data.type === "status") {
            setProgress({
              ratio: data.stage === "run" ? 1 : 0,
              label: data.stage === "run" ? "Transcribing" : "Loading model",
            });
            return;
          }
          if (data.type === "progress") {
            fileSizes.current.set(data.file, { loaded: data.loaded, total: data.total });
            let loaded = 0;
            let total = 0;
            for (const entry of fileSizes.current.values()) {
              loaded += entry.loaded;
              total += entry.total;
            }
            setProgress({
              ratio: total > 0 ? loaded / total : 0,
              label: `Loading model (${Math.round(loaded / 1e6)} / ${Math.round(total / 1e6)} MB)`,
            });
            return;
          }
          if (data.type === "error") {
            worker.removeEventListener("message", onMessage);
            setError(data.message);
            setRunning(false);
            setProgress(null);
            resolve(null);
            return;
          }
          if (data.type === "done") {
            worker.removeEventListener("message", onMessage);
            setRunning(false);
            setProgress(null);
            const segments: TranscriptSegment[] = data.chunks.map((chunk) => ({
              t: Math.round(chunk.start * 1000),
              endT: Math.round(chunk.end * 1000),
              text: chunk.text,
              final: true,
            }));
            resolve(segments);
          }
        };

        worker.addEventListener("message", onMessage);
        const request: WhisperRequest = { type: "transcribe", model, language, audio: samples };
        worker.postMessage(request, [samples.buffer as ArrayBuffer]);
      });
    },
    [],
  );

  return { transcribe, running, progress, device, error };
}
