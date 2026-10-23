import { useEffect, useState } from 'react'

// Typeless Rf: FFT 1024, 30ms samples, 100ms startup, attack .5 and release .1.
export function useMicrophoneVolume(analyser: AnalyserNode | null, sensitivity = 2) {
  const [volume, setVolume] = useState(0)
  useEffect(() => {
    if (!analyser) { setVolume(0); return }
    const meter = analyser.context.createAnalyser()
    meter.fftSize = 1024
    meter.smoothingTimeConstant = .8
    analyser.connect(meter)
    const samples = new Float32Array(new ArrayBuffer(meter.frequencyBinCount * 4))
    let smoothed = 0
    let timer = 0
    const start = window.setTimeout(() => { timer = window.setInterval(() => {
      if (meter.context.state !== 'running') return
      meter.getFloatTimeDomainData(samples)
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
      const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity
      const next = Math.min(1, Math.max(0, (Math.max(-50, db) + 50) / 50) * sensitivity)
      smoothed += (next - smoothed) * (next > smoothed ? .5 : .1)
      if (smoothed < .001) smoothed = 0
      setVolume(smoothed)
    }, 30) }, 100)
    return () => { window.clearTimeout(start); window.clearInterval(timer); analyser.disconnect(meter); meter.disconnect() }
  }, [analyser, sensitivity])
  return volume
}
