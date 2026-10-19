/**
 * Mic capture worklet: forwards raw mono frames to the UI thread.
 * Kept as plain JS so it can be loaded by URL without a build step.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.chunkSize = options?.processorOptions?.chunkSize ?? 1024
    this.buffer = new Float32Array(this.chunkSize)
    this.offset = 0
    this.drained = false
    this.port.onmessage = event => {
      if (event.data?.type !== 'drain') return
      this.drained = true
      if (this.offset) this.port.postMessage(this.buffer.slice(0, this.offset))
      this.offset = 0
      this.port.postMessage({ type: 'drained' })
    }
  }

  process(inputs) {
    if (this.drained) return true
    const input = inputs[0]
    if (!input || !input.length) return true
    const channel = input[0]
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.offset++] = channel[i]
      if (this.offset === this.chunkSize) {
        this.port.postMessage(this.buffer.slice(0))
        this.offset = 0
      }
    }
    return true
  }
}

registerProcessor('capture-processor', CaptureProcessor)
