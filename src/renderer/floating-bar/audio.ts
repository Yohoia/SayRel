const TARGET_RATE = 16000
export type RecorderHandle = { stream: MediaStream; stop: () => Promise<void>; analyser: AnalyserNode; context: AudioContext }

/** Capture and drain are one ordered stream, including the worklet's partial block. */
export async function startRecorder(opts: {
  deviceId?: string | null; onChunk: (pcm: Float32Array) => void; onLevel: (level: number) => void
}): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: {
    deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
    echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1
  }, video: false })
  let context: AudioContext
  try { context = new AudioContext() }
  catch (err) { stream.getTracks().forEach(track => track.stop()); throw err }
  try {
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.7
    source.connect(analyser)
    // A relative URL works under both the dev server and packaged file:// renderer.
    await context.audioWorklet.addModule('./capture-worklet.js').catch(() => undefined)
    const batch: number[] = []
    const batchTarget = TARGET_RATE / 10
    // Carry the fractional resampling bucket across source frames (44.1k and 48k).
    const ratio = context.sampleRate / TARGET_RATE
    let weight = 0, sum = 0
    const push = (frame: Float32Array) => {
      for (const sample of frame) {
        let remaining = 1
        while (remaining > 1e-9) {
          const take = Math.min(remaining, ratio - weight)
          sum += sample * take; weight += take; remaining -= take
          if (weight >= ratio - 1e-9) { batch.push(sum / ratio); sum = 0; weight = 0 }
        }
      }
      while (batch.length >= batchTarget) opts.onChunk(Float32Array.from(batch.splice(0, batchTarget)))
    }
    let node: AudioWorkletNode | ScriptProcessorNode
    let worklet: AudioWorkletNode | null = null
    let acknowledgeDrain: (() => void) | null = null
    try {
      worklet = new AudioWorkletNode(context, 'capture-processor', { numberOfInputs: 1, numberOfOutputs: 0, processorOptions: { chunkSize: 2048 } })
      node = worklet
      worklet.port.onmessage = event => {
        if (event.data?.type === 'drained') acknowledgeDrain?.()
        else if (event.data instanceof Float32Array) push(event.data)
      }
      source.connect(node)
      worklet.port.start?.()
    } catch {
      worklet = null
      const processor = context.createScriptProcessor(2048, 1, 1)
      processor.onaudioprocess = event => push(event.inputBuffer.getChannelData(0))
      source.connect(processor); processor.connect(context.destination); node = processor
    }
    await context.resume?.()
    const samples = new Uint8Array(analyser.fftSize)
    let raf = 0
    const tick = () => {
      analyser.getByteTimeDomainData(samples)
      let energy = 0
      for (const value of samples) energy += ((value - 128) / 128) ** 2
      opts.onLevel(Math.sqrt(energy / samples.length))
      raf = requestAnimationFrame(tick)
    }
    tick()
    let stopPromise: Promise<void> | null = null
    return { stream, analyser, context, stop: () => stopPromise ??= (async () => {
      cancelAnimationFrame(raf)
      try {
        source.disconnect()
        if (worklet) {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Audio buffer stop timed out")), 2000)
            acknowledgeDrain = () => { clearTimeout(timeout); resolve() }
            worklet!.port.postMessage({ type: 'drain' })
          })
        } else (node as ScriptProcessorNode).onaudioprocess = null
        if (batch.length) opts.onChunk(Float32Array.from(batch.splice(0)))
      } finally {
        node.disconnect()
        if (worklet) { worklet.port.onmessage = null; worklet.port.close?.() }
        stream.getTracks().forEach(track => track.stop())
        await context.close().catch(() => undefined)
      }
    })() }
  } catch (err) {
    stream.getTracks().forEach(track => track.stop())
    await context.close().catch(() => undefined)
    throw err
  }
}
export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  return (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput')
}
