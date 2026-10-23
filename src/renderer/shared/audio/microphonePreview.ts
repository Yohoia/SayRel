export type MicrophonePreview = {
  ready: Promise<AnalyserNode | null>
  stop: () => Promise<void>
}

/** A stopped preview never becomes ready, including when device opening finishes late. */
export function startMicrophonePreview({ audio, onLevel }: {
  audio: MediaTrackConstraints
  onLevel?: (level: number) => void
}): MicrophonePreview {
  let stopped = false
  let release = () => Promise.resolve()
  let stopPromise: Promise<void> | null = null
  const ready = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false })
    let context: AudioContext | null = null
    let source: MediaStreamAudioSourceNode | null = null
    let frame: number | null = null
    let releasePromise: Promise<void> | null = null
    release = () => {
      if (releasePromise) return releasePromise
      if (frame !== null) cancelAnimationFrame(frame)
      stream.getTracks().forEach(track => track.stop())
      source?.disconnect()
      return releasePromise = context ? context.close().catch(() => undefined) : Promise.resolve()
    }
    try {
      if (stopped) { await release(); return null }
      context = new AudioContext()
      const analyser = context.createAnalyser()
      if (onLevel) {
        analyser.fftSize = 2048
        analyser.smoothingTimeConstant = .7
      }
      source = context.createMediaStreamSource(stream)
      source.connect(analyser)
      await context.resume()
      if (stopped) { await release(); return null }
      if (onLevel) {
        const samples = new Uint8Array(analyser.fftSize)
        const tick = () => {
          if (stopped) return
          analyser.getByteTimeDomainData(samples)
          let energy = 0
          for (const value of samples) energy += ((value - 128) / 128) ** 2
          onLevel(Math.sqrt(energy / samples.length))
          if (!stopped) frame = requestAnimationFrame(tick)
        }
        tick()
      }
      return analyser
    } catch (failure) {
      await release()
      throw failure
    }
  })()
  return { ready, stop: () => {
    stopped = true
    void release()
    return stopPromise ??= ready.then(() => release(), () => release())
  } }
}
