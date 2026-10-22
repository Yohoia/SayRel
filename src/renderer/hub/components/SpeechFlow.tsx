import { useEffect, useId, useRef, useState } from 'react'
import lottie from 'lottie-web/build/player/lottie_svg'
import animationData from '../assets/wispr-hero-runtime.json'
import source from '../assets/wispr-hero-source.json'
import { useAppText } from '../../shared/i18n/useAppText'

// Mirror index.html: hero_animation-wrapper-v2; see docs/wispr-hero.md.
// Original composition with its one loopOut expression baked to keyframes for CSP.
export function SpeechFlow() {
  const t = useAppText()
  const id = useId().replaceAll(':', '')
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const rawStream = useRef<SVGSVGElement>(null)
  const cleanStream = useRef<SVGSVGElement>(null)
  const [paused, setPaused] = useState(false)
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const preferences = useRef({ paused, reduced })
  const syncPlayback = useRef(() => {})

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const container = root.current, host = canvas.current
    if (!container || !host) return
    let inView = false
    const streams = [rawStream.current, cleanStream.current]
    const animation = lottie.loadAnimation({
      container: host,
      renderer: 'svg',
      loop: true,
      autoplay: false,
      animationData: structuredClone(animationData),
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false }
    })
    const sync = () => {
      const running = !preferences.current.paused && !preferences.current.reduced && inView && !document.hidden
      container.dataset.running = String(running)
      if (running) animation.play()
      else animation.pause()
      streams.forEach(svg => {
        if (running) svg?.unpauseAnimations()
        else svg?.pauseAnimations()
      })
    }
    syncPlayback.current = sync
    const onReady = () => { container.dataset.ready = 'true'; sync() }
    const onFrame = () => {
      container.dataset.flowTime = String(Math.round(animation.currentFrame / animation.frameRate * 1000))
    }
    animation.addEventListener('DOMLoaded', onReady)
    animation.addEventListener('enterFrame', onFrame)
    const observer = new IntersectionObserver(([entry]) => { inView = entry?.isIntersecting ?? false; sync() })
    observer.observe(container)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      syncPlayback.current = () => {}
      observer.disconnect()
      document.removeEventListener('visibilitychange', sync)
      animation.removeEventListener('DOMLoaded', onReady)
      animation.removeEventListener('enterFrame', onFrame)
      animation.destroy()
    }
  }, [])

  useEffect(() => {
    preferences.current = { paused, reduced }
    syncPlayback.current()
  }, [paused, reduced])

  return <div className="home-speech-flow" ref={root} data-paused={paused || reduced} data-flow-time="0">
    <div className="home-speech-stage">
      <div className="home-speech-paths" aria-hidden="true">
        {source.tracks.map((track, index) => <svg key={index} ref={index === 0 ? rawStream : cleanStream} className={index === 0 ? 'home-speech-raw' : 'home-speech-clean'} viewBox={track.viewBox} fill="none">
          <path id={`${id}-${index}`} d={track.path} stroke={index === 0 ? 'var(--paper)' : 'var(--accent)'} strokeWidth={index === 0 ? 1 : 30} />
          <text x={track.travel}><textPath href={`#${id}-${index}`}>{track.copy}</textPath><animate attributeName="x" dur={`${track.duration}s`} values={`${track.travel};0`} repeatCount="indefinite" /></text>
        </svg>)}
      </div>
      <div className="home-speech-backplate" aria-hidden="true" />
      <div className="home-speech-lottie" ref={canvas} aria-hidden="true" />
      <button type="button" className="home-speech-bar" disabled={reduced} aria-label={t(paused || reduced ? 'Play animation' : 'Pause animation')} aria-pressed={paused || reduced} onClick={() => setPaused(value => !value)}>
        <span className="home-speech-play" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24"><path d="m9 5 10 7-10 7Z" fill="currentColor" /></svg></span>
      </button>
    </div>
  </div>
}
