import { useEffect, useState } from 'react'
import { WaveformBars } from '../shared/components/WaveformBars'

type Bar = { volume: number; age: number; recording: boolean }
type Impulse = { volume: number; timestamp: number }
const idle = (): Bar => ({ volume: 2, age: 0, recording: false })
const random = (min: number, max: number) => min + Math.random() * (max - min)

/** Original macOS amplitude response, noise floor and centre diffusion from DFvLNtQv. */
export function Waveform({ analyser, active, width, barWidth = 2, gap = 2 }: {
  analyser: AnalyserNode | null
  active: boolean
  width: number
  barWidth?: number
  gap?: number
}) {
  const count = Math.max(1, Math.floor((width + gap) / (barWidth + gap)))
  const [bars, setBars] = useState<Bar[]>(() => Array.from({ length: count }, idle))

  useEffect(() => {
    let values = Array.from({ length: count }, idle)
    if (!analyser || !active) {
      if (active && document.documentElement.dataset.uiReview === 'fixture') {
        const heights = [2, 4, 7, 12, 18, 15, 10, 6, 4, 2]
        values = values.map((bar, i) => ({ ...bar, volume: heights[i % heights.length] }))
      }
      setBars(values)
      return
    }
    const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
    const buffer: number[] = []
    const impulses: Impulse[] = []
    const timeouts = new Set<number>()
    let noiseFloor = 0
    let smoothedHeight = 3
    let lastSample = 0
    let raf = 0
    let disposed = false
    const publish = () => { if (!disposed) setBars(values.map((bar) => ({ ...bar }))) }

    const spread = (impulse: Impulse) => {
      const center = Math.max(0, Math.min(count - 1, Math.floor(count / 2) + Math.floor((Math.random() - .5) * Math.min(count * .15, 3))))
      values[center] = { recording: true, volume: Math.round(impulse.volume * random(.95, 1.05)), age: 0 }
      const sides = [center, count - 1 - center]
      for (let distance = 1; distance <= Math.max(...sides); distance++) {
        for (const direction of [-1, 1]) {
          const index = center + direction * distance
          if (index < 0 || index >= count) continue
          const extent = sides[direction === -1 ? 0 : 1]
          const decay = Math.max(.12, 1 - distance / Math.max(extent, 1) * (.65 + Math.random() * .08))
          const volume = Math.max(2, Math.round(impulse.volume * decay * random(.9, 1.1)))
          const delay = distance * 80 * (.15 + Math.random() * .05) + Math.random() * 15
          const timer = window.setTimeout(() => {
            timeouts.delete(timer)
            if (disposed) return
            const blend = random(.65, .75)
            values[index] = { recording: true, volume: Math.max(volume, Math.round(values[index].volume * (1 - blend) + volume * blend)), age: Math.floor(Math.random() * 2) }
            publish()
          }, delay)
          timeouts.add(timer)
        }
      }
    }

    const render = () => {
      if (disposed) return
      const now = Date.now()
      analyser.getByteFrequencyData(data)
      let sum = 0
      const end = Math.min(140, data.length - 1)
      for (let i = 14; i <= end; i++) sum += data[i]
      buffer.push(end >= 14 ? sum / (end - 13) : 0)
      if (buffer.length > 3) buffer.shift()
      const mean = buffer.reduce((a, b) => a + b, 0) / Math.max(1, buffer.length) / 255
      if (now - lastSample >= 50) {
        lastSample = now
        const follow = mean <= noiseFloor + .01 ? .06 : .002
        noiseFloor = Math.max(0, Math.min(.35, noiseFloor * (1 - follow) + mean * follow))
        const volume = Math.max(0, mean - noiseFloor - .006)
        let enhanced: number
        if (volume < .03) enhanced = .12 + volume / .03 * .18 + Math.random() * .03
        else if (volume < .1) enhanced = Math.max(.31, Math.min(.79, .36 + (volume - .03) / .07 * .42 + random(-.1, .1)))
        else {
          const voice = (volume - .1) / .9
          let response = Math.max(0, Math.min(1, Math.pow(voice, .25) + random(-1, 1) * Math.max(.15, .25 * voice)))
          if (voice > .4) response = Math.min(1, response * (1.4 + random(-.2, .2)))
          enhanced = Math.max(.45, Math.min(1, .55 + .4 * response + random(-.1, .1)))
        }
        enhanced = Math.max(.12, Math.min(1, enhanced))
        smoothedHeight = smoothedHeight * .15 + Math.max(2, Math.min(18, 2 + Math.round(16 * enhanced))) * .85
        if (volume > Math.max(.03 * .5, .1 * .7) && Math.random() < Math.min(.8, volume * 2)) {
          impulses.push({ volume: Math.max(2, Math.min(20, Math.round(Math.round(smoothedHeight) * random(.9, 1.1)))), timestamp: now })
        }
      }
      while (impulses.length && now - impulses[0].timestamp >= 80) spread(impulses.shift()!)
      values = values.map((bar, i) => {
        if (!bar.recording) return bar
        const age = bar.age + (Math.random() > .7 ? 1 : Math.random() > .95 ? 2 : 0)
        const position = 1 + Math.abs(i - Math.floor(count / 2)) / count * .3
        const decay = Math.max(.95, random(.98, .995) / position)
        const height = Math.max(2, Math.round(bar.volume * Math.pow(decay, age / 12) * random(.95, 1.05)))
        return age > 50 + Math.floor(Math.random() * 15) || height <= 2 ? idle() : { recording: true, volume: height, age }
      })
      publish()
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      timeouts.forEach((timer) => window.clearTimeout(timer))
    }
  }, [analyser, active, count])

  return <WaveformBars values={bars.map(bar => bar.volume)} active={active} width={width} barWidth={barWidth} gap={gap} color="var(--accent-ink)" inactiveColor="color-mix(in srgb,var(--accent-ink) 50%,transparent)" borderRadius={9999} />
}
