import { useEffect, useId, useState } from 'react'

// DWYvEY4x:126–254, Rf:8974–9043. Only the two gradient colors are themed.
export function useMicrophoneVolume(analyser: AnalyserNode | null) {
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
      meter.getFloatTimeDomainData(samples)
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
      const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity
      const next = Math.min(1, Math.max(0, (Math.max(-50, db) + 50) / 50) * 2)
      smoothed += (next - smoothed) * (next > smoothed ? .5 : .1)
      if (smoothed < .001) smoothed = 0
      setVolume(smoothed)
    }, 30) }, 100)
    return () => { window.clearTimeout(start); window.clearInterval(timer); analyser.disconnect(meter); meter.disconnect() }
  }, [analyser])
  return volume
}

export function VolumeGlow({ volume }: { volume: number }) {
  const id = useId().replace(/:/g, '_')
  const level = Math.min(Math.max(volume, 0), 1)
  const top = 100 - (5 + level * 75)
  const inner = 48 * (.6 - level * .55)
  const outer = 48 * (.2 + level * .6)
  const shape = `M 2,100 C ${2 + outer},100 ${50 - inner},${top} 50,${top} C ${50 + inner},${top} ${98 - outer},100 98,100 L 98,120 L 2,120 Z`
  return <div className="floating-volume-glow" aria-hidden="true">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <mask id={`mountain-${id}`}><path d={shape} fill="white" /></mask>
        {[false, true].map(right => <linearGradient key={String(right)} id={`${right ? 'right' : 'left'}-${id}`} x1={right ? '0%' : '100%'} y1="100%" x2={right ? '100%' : '0%'} y2="0%">
          <stop stopColor="var(--floating-glow-high)" offset="0%" />
          <stop stopColor="var(--floating-glow-low)" offset="50%" />
          <stop stopColor="var(--floating-glow-low)" offset="100%" />
        </linearGradient>)}
      </defs>
      <g mask={`url(#mountain-${id})`}><g shapeRendering="crispEdges">
        <rect x="0" y="0" width="50" height="100" fill={`url(#left-${id})`} />
        <rect x="50" y="0" width="50" height="100" fill={`url(#right-${id})`} />
        <rect x="0" y="100" width="100" height="20" fill="var(--floating-glow-high)" />
      </g></g>
    </svg>
  </div>
}
