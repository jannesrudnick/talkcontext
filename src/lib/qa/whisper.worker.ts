/// <reference lib="webworker" />
/**
 * Local transcription with Whisper (ONNX) via transformers.js.
 *
 * Runs in a worker so neither the model download nor inference blocks the UI.
 * The audio already arrives as a 16 kHz mono Float32Array from the main
 * thread - AudioContext does not exist in workers.
 *
 * Everything stays in the browser: no upload, no API key.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

// Only models from the Hub, don't look in /models of our own public folder.
env.allowLocalModels = false;
// We host the WASM runtime ourselves (scripts/copy-ort-runtime.mjs) instead of a
// CDN - otherwise a "runs locally" feature would need third-party servers after all.
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = "/ort/";

export type WhisperModelId =
  | "onnx-community/whisper-tiny"
  | "onnx-community/whisper-base"
  | "onnx-community/whisper-small";

export interface WhisperRequest {
  type: "transcribe";
  model: WhisperModelId;
  /** BCP-47 like "en-US" - Whisper only wants the language part. */
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

  // Verified against onnxruntime-web 1.26: the "_quantized"/"int8" decoders from
  // onnx-community fail to load ("Missing required scale ... for
  // MatMulNBits"). q4 works, the encoder may be q8 - compared to fp32 that
  // saves about 20 MB of download with no quality loss in testing.
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
    post({ type: "status", stage: "load", message: "Loading model" });
    const transcriber = await getPipeline(request.model);

    post({ type: "status", stage: "run", message: "Transcribing audio" });
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
