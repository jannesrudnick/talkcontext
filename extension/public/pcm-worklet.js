/**
 * AudioWorklet: converts the microphone signal into 16-bit PCM packets (~100 ms).
 * The sample rate is set by the AudioContext (for OpenAI Realtime: 24 kHz).
 */
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 10);
    this.buffer = new Int16Array(this.size);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.offset === this.size) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(this.size);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("talkcontext-pcm-capture", PcmCapture);
