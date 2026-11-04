/**
 * Live transcript via Soniox real-time STT (WebSocket, ~$0.12/h).
 *
 * Browsers can't send headers with WebSockets - the key goes in the
 * subprotocol list as `["soniox-api-key", <key>]`.
 *
 * Soniox sends tokens with `start_ms`/`end_ms` relative to the start of the sent stream.
 * Final tokens never change, so only those are forwarded (as deltas for the
 * live bubble) and collected into a segment. A segment is closed by Soniox's
 * endpoint detection (`<end>` token), a longer pause, or on stop.
 */
import type { LiveTextEvent } from "@/lib/messages";
import type { LiveState } from "@/lib/types";
import { resolveSonioxModel } from "@/lib/transcription/soniox";

const URL = "wss://stt-rt.soniox.com/transcribe-websocket";
const SAMPLE_RATE = 16000;
const GAP_MS = 1500;

export interface SonioxTranscriberOptions {
  apiKey: string;
  /** Model id or "latest". */
  model: string;
  language: string;
  onText: (event: LiveTextEvent) => void;
  onState: (state: LiveState, error?: string) => void;
}

interface SonioxToken {
  text: string;
  is_final?: boolean;
  start_ms?: number;
  end_ms?: number;
}

export class SonioxTranscriber {
  private socket: WebSocket | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private pending: ArrayBuffer[] = [];
  private ready = false;
  private closed = false;
  private finished: (() => void) | null = null;
  /** epoch ms at which the first sent sample was recorded. */
  private streamStart = 0;
  private segment = { id: 0, text: "", start: 0, end: 0 };

  constructor(private options: SonioxTranscriberOptions) {}

  async start(stream: MediaStream) {
    this.options.onState("connecting");

    this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
    await this.context.audioWorklet.addModule(browser.runtime.getURL("/pcm-worklet.js"));
    this.node = new AudioWorkletNode(this.context, "talkcontext-pcm-capture");
    this.node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => this.onAudio(event.data);
    this.context.createMediaStreamSource(stream).connect(this.node);

    // Audio is buffered in `pending` meanwhile.
    const model = await resolveSonioxModel(this.options.apiKey, this.options.model);
    if (this.closed) return;
    this.socket = new WebSocket(URL, ["soniox-api-key", this.options.apiKey]);
    this.socket.addEventListener("open", () => {
      this.socket?.send(
        JSON.stringify({
          model,
          audio_format: "pcm_s16le",
          sample_rate: SAMPLE_RATE,
          num_channels: 1,
          language_hints: [this.options.language.split("-")[0]],
          enable_endpoint_detection: true,
        }),
      );
      this.ready = true;
      for (const chunk of this.pending.splice(0)) this.socket?.send(chunk);
      this.options.onState("on");
    });
    this.socket.addEventListener("message", (event) => this.onServerEvent(String(event.data)));
    this.socket.addEventListener("error", () => {
      if (!this.closed) this.options.onState("error", "Connection to Soniox failed");
    });
    this.socket.addEventListener("close", (event) => {
      this.finished?.();
      if (this.closed) return;
      this.ready = false;
      this.options.onState("error", event.reason || `Connection closed (${event.code})`);
    });
  }

  /** Stops capturing, lets Soniox finish the pending audio (max 3 s). */
  async stop(): Promise<void> {
    this.closed = true;
    this.node?.disconnect();
    void this.context?.close().catch(() => undefined);
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) {
      socket?.close();
      return;
    }
    // An empty text frame ends the stream; Soniox answers with the rest and closes.
    const done = new Promise<void>((resolve) => {
      this.finished = resolve;
      setTimeout(resolve, 3000);
    });
    socket.send("");
    await done;
    this.flush();
    socket.close();
  }

  private onAudio(buffer: ArrayBuffer) {
    if (!this.streamStart) this.streamStart = Date.now() - 100;
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(buffer);
    } else if (this.pending.length < 300) {
      // Buffer until the session is up (~30 s max) so nothing gets lost.
      this.pending.push(buffer);
    }
  }

  private onServerEvent(raw: string) {
    let event: { tokens?: SonioxToken[]; error_message?: string; finished?: boolean };
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    if (event.error_message) {
      this.options.onState("error", event.error_message);
      return;
    }
    for (const token of event.tokens ?? []) {
      if (!token.is_final) continue;
      if (token.text === "<end>") {
        this.flush();
        continue;
      }
      const start = token.start_ms ?? this.segment.end;
      // A long pause without an endpoint: start a new segment.
      if (this.segment.text && start - this.segment.end > GAP_MS) this.flush();
      if (!this.segment.text) this.segment.start = start;
      this.segment.text += token.text;
      this.segment.end = token.end_ms ?? start;
      const delta = this.segment.text === token.text ? token.text.trimStart() : token.text;
      this.options.onText({ kind: "delta", itemId: String(this.segment.id), delta });
    }
    if (event.finished) this.finished?.();
  }

  private flush() {
    const { id, text, start, end } = this.segment;
    if (!text.trim()) return;
    this.options.onText({
      kind: "final",
      itemId: String(id),
      text: text.trim(),
      start: this.streamStart + start,
      end: this.streamStart + end,
    });
    this.segment = { id: id + 1, text: "", start: 0, end: 0 };
  }
}
