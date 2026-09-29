/**
 * AudioWorklet: wandelt das Mikrofon-Signal in 16-bit-PCM-Pakete (~100 ms).
 * Die Samplerate bestimmt der AudioContext (fuer OpenAI Realtime: 24 kHz).
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

registerProcessor("qey-pcm-capture", PcmCapture);
