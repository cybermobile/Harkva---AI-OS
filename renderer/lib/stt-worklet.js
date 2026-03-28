/**
 * AudioWorklet processor that downsamples mic input to 16kHz mono Float32
 * and posts the raw bytes to the main thread via port.postMessage.
 */
class STTProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.targetRate = 16000;
    // sampleRate is a global in AudioWorklet scope
    this.ratio = sampleRate / this.targetRate;
    this.chunkSize = 4096; // frames to accumulate before sending
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;

    const channelData = input[0]; // mono channel

    // Downsample by picking every Nth sample
    for (let i = 0; i < channelData.length; i++) {
      this.buffer.push(channelData[i]);
    }

    // When we have enough samples, downsample and send
    while (this.buffer.length >= this.chunkSize) {
      const chunk = this.buffer.splice(0, this.chunkSize);
      const outputLength = Math.floor(chunk.length / this.ratio);
      const output = new Float32Array(outputLength);

      for (let i = 0; i < outputLength; i++) {
        output[i] = chunk[Math.floor(i * this.ratio)];
      }

      this.port.postMessage(output.buffer, [output.buffer]);
    }

    return true;
  }
}

registerProcessor('stt-processor', STTProcessor);
