/**
 * Live transcript via OpenAI Realtime (transcription session over WebSocket).
 *
 * Browsers can't send headers with WebSockets - so the API key goes along
 * as the subprotocol `openai-insecure-api-key.<key>`. That's fine,
 * because the key only lives locally in the extension anyway and the connection
 * goes directly to api.openai.com.
 *
 * Timestamps: OpenAI reports `audio_start_ms`/`audio_end_ms` relative to the
 * start of the sent audio stream. We remember when the first packet
 * was recorded and derive epoch ms from that.
 */
import type { LiveTextEvent } from "@/lib/messages";
import type { LiveState } from "@/lib/types";

// Overridable at build time for tests against a mock server (WXT_REALTIME_URL).
const REALTIME_URL: string =
  (import.meta.env.WXT_REALTIME_URL as string | undefined) || "wss://api.openai.com/v1/realtime?intent=transcription";
const SAMPLE_RATE = 24000;

export interface LiveTranscriberOptions {
  apiKey: string;
  model: string;
  language: string;
  onText: (event: LiveTextEvent) => void;
  onState: (state: LiveState, error?: string) => void;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export class LiveTranscriber {
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private pending: string[] = [];
  private ready = false;
  private closed = false;
  /** epoch ms at which the first sent sample was recorded. */
  private streamStart = 0;
  private starts = new Map<string, number>();
  private ends = new Map<string, number>();

  constructor(private options: LiveTranscriberOptions) {}

  async start(stream: MediaStream) {
    this.options.onState("connecting");

    this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.context.audioWorklet.addModule(browser.runtime.getURL("/pcm-worklet.js"));
    this.node = new AudioWorkletNode(this.context, "qey-pcm-capture");
    this.node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => this.onAudio(event.data);
    this.context.createMediaStreamSource(stream).connect(this.node);

    this.socket = new WebSocket(REALTIME_URL, ["realtime", `openai-insecure-api-key.${this.options.apiKey}`]);
    this.socket.addEventListener("open", () => {
      this.send({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: SAMPLE_RATE },
              noise_reduction: { type: "near_field" },
              transcription: {
                model: this.options.model,
                language: this.options.language.split("-")[0],
              },
              turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600 },
            },
          },
        },
      });
    });
    this.socket.addEventListener("message", (event) => this.onServerEvent(String(event.data)));
    this.socket.addEventListener("error", () => {
      if (!this.closed) this.options.onState("error", "Connection to OpenAI Realtime failed");
    });
    this.socket.addEventListener("close", (event) => {
      if (this.closed) return;
      this.ready = false;
      this.options.onState("error", event.reason || `Connection closed (${event.code})`);
    });
  }

  /** Stops capturing and briefly waits for pending segments. */
  async stop(): Promise<void> {
    this.closed = true;
    this.node?.disconnect();
    void this.context?.close().catch(() => undefined);
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) {
      socket?.close();
      return;
    }
    // Let the rest of the buffer be transcribed - but only if someone was
    // just speaking or a segment is still pending.
    if (this.starts.size > 0) {
      this.send({ type: "input_audio_buffer.commit" });
      const deadline = Date.now() + 3000;
      while (this.starts.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    socket.close();
  }

  private send(payload: unknown) {
    this.socket?.send(JSON.stringify(payload));
  }

  private onAudio(buffer: ArrayBuffer) {
    if (!this.streamStart) this.streamStart = Date.now() - 100;
    const chunk = JSON.stringify({ type: "input_audio_buffer.append", audio: toBase64(buffer) });
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(chunk);
    } else if (this.pending.length < 300) {
      // Buffer until the session is up (~30 s max) so nothing gets lost.
      this.pending.push(chunk);
    }
  }

  private onServerEvent(raw: string) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = event.type as string;
    const itemId = String(event.item_id ?? "");

    switch (type) {
      case "session.updated":
      case "transcription_session.updated": {
        if (this.ready) return;
        this.ready = true;
        for (const chunk of this.pending.splice(0)) this.socket?.send(chunk);
        this.options.onState("on");
        return;
      }
      case "input_audio_buffer.speech_started":
        this.starts.set(itemId, this.streamStart + Number(event.audio_start_ms ?? 0));
        return;
      case "input_audio_buffer.speech_stopped":
        this.ends.set(itemId, this.streamStart + Number(event.audio_end_ms ?? 0));
        return;
      case "conversation.item.input_audio_transcription.delta":
        if (event.delta) this.options.onText({ kind: "delta", itemId, delta: String(event.delta) });
        return;
      case "conversation.item.input_audio_transcription.completed": {
        const text = String(event.transcript ?? "").trim();
        const start = this.starts.get(itemId) ?? Date.now() - 2000;
        const end = this.ends.get(itemId) ?? Date.now();
        this.starts.delete(itemId);
        this.ends.delete(itemId);
        this.options.onText({ kind: "final", itemId, text, start, end });
        return;
      }
      case "error": {
        const error = event.error as { message?: string } | undefined;
        this.options.onState("error", error?.message ?? "Unknown error from OpenAI Realtime");
        return;
      }
      default:
        return;
    }
  }
}
