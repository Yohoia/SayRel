import { useLayoutEffect, useRef, useState } from 'react'
import { useAppText } from '../shared/i18n/useAppText'

export function LiveTranscript({ text, phase, raised }: {
  text: string
  phase: 'recording' | 'processing'
  raised: boolean
}) {
  const t = useAppText()
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState<number | null>(null)
  const [moving, setMoving] = useState(false)
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return
    const follow = () => {
      const remaining = viewport.clientWidth - track.scrollWidth
      setOffset(Math.min(remaining / 2, remaining - 24))
    }
    follow()
    const observer = new ResizeObserver(follow)
    observer.observe(viewport)
    observer.observe(track)
    // Paint the measured starting position before allowing later text to slide.
    let motionFrame = 0
    const placementFrame = requestAnimationFrame(() => {
      motionFrame = requestAnimationFrame(() => setMoving(true))
    })
    return () => { observer.disconnect(); cancelAnimationFrame(placementFrame); cancelAnimationFrame(motionFrame) }
  }, [])

  return <div className="floating-transcript" role="region" aria-label={t('Live transcript preview')} aria-live="off"
    data-phase={phase} data-raised={raised || undefined} data-positioned={offset !== null || undefined} data-moving={moving || undefined}>
    <div ref={viewportRef} className="floating-transcript-viewport">
      <div ref={trackRef} className="floating-transcript-track" style={{ transform: `translate3d(${offset ?? 0}px,0,0)` }}>
        <span className="floating-transcript-text">{text.replace(/\s*\n\s*/g, ' ')}</span>
        {phase === 'recording' && <span className="floating-transcript-cursor" aria-hidden="true" />}
      </div>
    </div>
    <span className="floating-transcript-edge is-left" aria-hidden="true" />
    <span className="floating-transcript-edge is-right" aria-hidden="true" />
  </div>
}
