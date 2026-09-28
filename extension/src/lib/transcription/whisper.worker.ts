/// <reference lib="webworker" />
/**
 * Lokale Transkription mit Whisper (ONNX) via transformers.js.
 *
 * Laeuft im Worker, damit weder Modell-Download noch Inferenz die Oberflaeche
 * blockieren. Das Audio kommt bereits als 16-kHz-Mono-Float32Array aus dem
 * Hauptthread - AudioContext gibt es im Worker nicht.
 *
 * Alles bleibt im Browser: kein Upload, kein API-Key.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import type { WhisperModelId } from "@/lib/types";

// Nur Modelle vom Hub, nichts aus /models im eigenen Public-Ordner suchen.
env.allowLocalModels = false;
// Die WASM-Runtime liegt im Extension-Paket (scripts/copy-ort-runtime.mjs) statt
// auf einem CDN - die CSP der Extension wuerde fremden Code ohnehin blockieren.
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = `${self.location.origin}/ort/`;

export interface WhisperRequest {
  type: "transcribe";
  model: WhisperModelId;
  /** BCP-47 wie "de-DE" - Whisper will nur den Sprachteil. */
  language: string;
  audio: Float32Array;
}

export interface WhisperChunk {
  start: number;
  end: number;
  text: string;
}

export type WhisperResponse =
  | { type: "status"; stage: "load" | "run"; message: string }
  | { type: "progress"; file: string; loaded: number; total: number }
  | { type: "device"; device: "webgpu" | "wasm" }
  | { type: "done"; text: string; chunks: WhisperChunk[] }
  | { type: "error"; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(message: WhisperResponse) {
  scope.postMessage(message);
}

let cached: { model: WhisperModelId; pipe: AutomaticSpeechRecognitionPipeline } | null = null;
let cachedDevice: "webgpu" | "wasm" = "wasm";

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

async function getPipeline(model: WhisperModelId) {
  if (cached?.model === model) return cached.pipe;

  const webgpu = await hasWebGpu();
  cachedDevice = webgpu ? "webgpu" : "wasm";
  post({ type: "device", device: cachedDevice });

  // Geprueft gegen onnxruntime-web 1.26: die "_quantized"/"int8"-Decoder von
  // onnx-community lassen sich nicht laden ("Missing required scale ... for
  // MatMulNBits"). q4 funktioniert, der Encoder darf q8 sein - das spart
  // gegenueber fp32 rund 20 MB Download ohne Qualitaetsverlust im Test.
  const dtype = { encoder_model: "q8", decoder_model_merged: "q4" } as const;

  const pipe = (await pipeline("automatic-speech-recognition", model, {
    device: cachedDevice,
    dtype,
    progress_callback: (progress: unknown) => {
      const item = progress as { status?: string; file?: string; loaded?: number; total?: number };
      if (item.status === "progress" && item.file) {
        post({ type: "progress", file: item.file, loaded: item.loaded ?? 0, total: item.total ?? 0 });
      }
    },
  })) as AutomaticSpeechRecognitionPipeline;

  cached = { model, pipe };
  return pipe;
}

scope.addEventListener("message", async (event: MessageEvent<WhisperRequest>) => {
  const request = event.data;
  if (!request || request.type !== "transcribe") return;

  try {
    post({ type: "status", stage: "load", message: "Modell wird geladen" });
    const transcriber = await getPipeline(request.model);

    post({ type: "status", stage: "run", message: "Audio wird transkribiert" });
    const output = (await transcriber(request.audio, {
      language: request.language.split("-")[0],
      task: "transcribe",
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    })) as { text?: string; chunks?: Array<{ timestamp: [number, number | null]; text: string }> };

    const chunks: WhisperChunk[] = (output.chunks ?? [])
      .map((chunk) => ({
        start: chunk.timestamp[0] ?? 0,
        end: chunk.timestamp[1] ?? chunk.timestamp[0] ?? 0,
        text: chunk.text.trim(),
      }))
      .filter((chunk) => chunk.text.length > 0);

    post({ type: "done", text: (output.text ?? "").trim(), chunks });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
});
