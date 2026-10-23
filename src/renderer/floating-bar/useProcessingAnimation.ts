import { useEffect, useRef, useState } from 'react'

// DFvLNtQv je/Ta/Ia: finishing fills to 99%, then holds 100% for 350ms.
const KEYFRAMES = [[0, 0], [1, 80], [2, 90], [3, 95], [4, 97], [5, 98], [10, 99]]
export function processingProgress(seconds: number): number {
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    const [start, from] = KEYFRAMES[i], [end, to] = KEYFRAMES[i + 1]
    if (seconds >= start && seconds < end) return from + (seconds - start) / (end - start) * (to - from)
  }
  return 99
}

export function useProcessingAnimation(refining: boolean) {
  const [visible, setVisible] = useState(false)
  const [progress, setProgress] = useState(0)
  const wasVisible = useRef(false)
  useEffect(() => {
    let frame = 0, timer = 0
    if (refining) {
      wasVisible.current = true
      setVisible(true); setProgress(0)
      const start = performance.now()
      const tick = () => {
        const next = processingProgress((performance.now() - start) / 1000)
        setProgress(next)
        if (next < 99) frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    } else if (wasVisible.current) {
      setProgress(100)
      timer = window.setTimeout(() => {
        wasVisible.current = false
        setVisible(false); setProgress(0)
      }, 350)
    }
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer) }
  }, [refining])
  return { visible, progress }
}
