export type MicrophonePreview = {
  ready: Promise<AnalyserNode | null>
  stop: () => Promise<void>
}

/** A stopped preview never becomes ready, including when device opening finishes late. */
export function startMicrophonePreview(audio: MediaTrackConstraints): MicrophonePreview {
  let stopped = false
  let release = () => Promise.resolve()
  let stopPromise: Promise<void> | null = null
  const ready = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false })
    let context: AudioContext | null = null
    let source: MediaStreamAudioSourceNode | null = null
    let releasePromise: Promise<void> | null = null
    release = () => {
      if (releasePromise) return releasePromise
      stream.getTracks().forEach(track => track.stop())
      source?.disconnect()
      return releasePromise = context ? context.close().catch(() => undefined) : Promise.resolve()
    }
    try {
      if (stopped) { await release(); return null }
      context = new AudioContext()
      const analyser = context.createAnalyser()
      source = context.createMediaStreamSource(stream)
      source.connect(analyser)
      await context.resume()
      if (stopped) { await release(); return null }
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
