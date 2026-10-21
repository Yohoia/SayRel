import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import { api } from '../shared/utils/bridge'
import { Waveform } from './Waveform'
import { startRecorder, type RecorderHandle } from './audio'
import { RecorderSessionController } from './sessionController'
import { useHotkeyState } from './useHotkeyState'
import { ShimmerText } from './ShimmerText'
import { StatusIcons } from './StatusIcons'
import { Icon } from '../shared/components/Icons'
import './styles.css'

type BarStatus =
  | 'idle-hidden'
  | 'hover'
  | 'starting-microphone'
  | 'recording'
  | 'recording-dictating'
  | 'hands-free'
  | 'hands-free-dictating'
  | 'error'
  | 'long-pressing'

const BASE_STYLE = {
  opacity: 0.5,
  background: '#808080',
  width: 40,
  height: 6,
  borderRadius: 99,
  boxShadow:
    '0px 2px 4px 0px rgba(0, 0, 0, 0.25), 0px 0px 20px 0px rgba(0, 0, 0, 0.15), 0px 25px 30px 0px rgba(0, 0, 0, 0.25)',
  transition: 'all 0.2s cubic-bezier(0.05, 0.6, 0.4, 0.95)',
  willChange: 'opacity, transform, background-color, width, height',
  backfaceVisibility: 'hidden' as const,
  transformOrigin: 'center' as const
}

const SIZES = {
  padX: 6,
  padY: 4,
  height: 34,
  width: 70,
  handsFreeWidth: 116,
  border: '1px solid rgba(255, 255, 255, 0.32)'
}

export function FloatingBarApp() {
  const [status, setStatus] = useState<BarStatus>('idle-hidden')
  const [hover, setHover] = useState(false)
  const [countdown, setCountdown] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const languageChoicesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    const off = window.offkey?.on('store:changed', (next: Settings) => { if (live) setSettings(next) })
    void api.settings.get().then((next: Settings) => { if (live && next) setSettings(next) })
    return () => { live = false; off?.() }
  }, [])
  const [mode, setMode] = useState('voice_transcript')
  const [recorder, setRecorder] = useState<RecorderHandle | null>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  const hotkey = useHotkeyState(mode)

  useEffect(() => {
    const controller = new RecorderSessionController({
      settings: api.settings.get,
      isMuted: api.audio.isMuted,
      mute: api.audio.mute,
      unmute: api.audio.unmute,
      status: api.recording.status,
      start: startRecorder,
      onRecorder: setRecorder
    })
    let disposed = false
    let receivedState = false
    const update = (state: any) => {
      if (disposed || !state) return
      controller.sync(state)
      if (state.context?.mode) setMode(state.context.mode)
      if (state.phase === 'starting') { setStatus('starting-microphone'); setErrorText(null) }
      if (state.phase === 'recording') setStatus(state.context?.handsFree ? 'hands-free' : 'recording')
      if (state.phase === 'finishing') setStatus(state.context?.handsFree ? 'hands-free-dictating' : 'recording-dictating')
      if (state.phase === 'idle') setStatus('idle-hidden')
      if (state.phase === 'long_pressing') setStatus('long-pressing')
      if (state.phase === 'error') { setStatus('error'); setErrorText(state.context?.error || '转录失败，请重试。') }
      const timeout = state.context?.recorderTimeoutState
      if (timeout?.remainingTime > 0 && timeout.timeUntilCountdown <= 0) {
        const total = Math.floor(timeout.remainingTime)
        setCountdown(`${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`)
      } else setCountdown(null)
    }
    const off = window.offkey?.on?.('recording-machine:state', (state: any) => { receivedState = true; update(state) })
    void api.recording.state().then((state: any) => { if (!receivedState) update(state) }).catch(() => undefined)
    return () => { disposed = true; off?.(); void controller.dispose() }
  }, [])

  // The native transparent window needs screen-space hit regions. Forwarded
  // mouse movement alone cannot restore clicks after setIgnoreMouseEvents.
  useEffect(() => {
    let previous = ''
    const update = () => {
      const pill = pillRef.current
      if (!pill) return
      const rect = pill.getBoundingClientRect()
      const regions = [{
        left: window.screenX + rect.left, top: window.screenY + rect.top,
        right: window.screenX + rect.right, bottom: window.screenY + rect.bottom
      }]
      const choices = languageChoicesRef.current?.getBoundingClientRect()
      if (choices) regions.push({ left: window.screenX + choices.left, top: window.screenY + choices.top, right: window.screenX + choices.right, bottom: window.screenY + choices.bottom })
      const serialized = JSON.stringify(regions)
      if (serialized === previous) return
      previous = serialized
      void api.page.updatePositions(regions).catch(() => undefined)
    }
    update()
    const timer = window.setInterval(update, 100)
    return () => { window.clearInterval(timer); void api.page.updatePositions([]).catch(() => undefined) }
  }, [])

  const click = (action: 'start' | 'finish' | 'cancel' | 'retry') => {
    void api.page.floatingBarClick(action).catch((error: unknown) => {
      setErrorText(error instanceof Error ? error.message : '无法更新录音状态，请重试。')
      setStatus('error')
    })
  }

  // Screenshot fixtures can display a state without starting a real recording.
  const [preview, setPreview] = useState<{ status: BarStatus; countdown?: string; error?: string; mode?: string } | null>(null)
  useEffect(() => {
    if (document.documentElement.dataset.uiReview !== 'fixture') return
    const show = (event: Event) => {
      const detail = (event as CustomEvent).detail
      const allowed: BarStatus[] = ['idle-hidden', 'hover', 'starting-microphone', 'recording', 'recording-dictating', 'hands-free', 'hands-free-dictating', 'error', 'long-pressing']
      if (detail === null) setPreview(null)
      else if (allowed.includes(detail?.status)) setPreview(detail)
    }
    const params = new URLSearchParams(window.location.search)
    if (params.has('state')) show(new CustomEvent('offkey:ui-review-floating-bar', { detail: {
      status: params.get('state'), mode: params.get('mode') ?? 'voice_transcript',
      countdown: params.get('countdown') ?? undefined,
      error: params.get('state') === 'error' ? '无法访问麦克风，请检查系统权限后重试。' : undefined
    } }))
    window.addEventListener('offkey:ui-review-floating-bar', show)
    return () => window.removeEventListener('offkey:ui-review-floating-bar', show)
  }, [])

  const visibleStatus = preview?.status ?? status
  const visibleCountdown = preview?.countdown ?? countdown
  const visibleError = preview?.error ?? errorText
  const visibleMode = preview?.mode ?? mode
  const style = useMemo(() => computeStyle(visibleStatus, !!visibleCountdown), [visibleStatus, visibleCountdown])
  const refining = visibleStatus === 'recording-dictating' || visibleStatus === 'hands-free-dictating'
  const handsFree = visibleStatus === 'hands-free'
  const showWaveform = visibleStatus === 'recording' || handsFree
  const onPointerEnter = () => {
    setHover(true)
    if (!preview && status === 'idle-hidden') setStatus('hover')
  }
  const onPointerLeave = () => {
    setHover(false)
    if (!preview && status === 'hover') setStatus('idle-hidden')
  }

  return (
    <div className="floating-bar-surface">
      <style>{`@keyframes loadingMove { 0% { transform: translateX(-27px); } 100% { transform: translateX(54px); } }`}</style>
      {visibleStatus === 'error' && visibleError && <div style={errorBubbleStyle}>{visibleError}</div>}
      {visibleStatus === 'long-pressing' && <div role="status" style={errorBubbleStyle}>轻按即可开始，无需长按。再次轻按结束录音。</div>}
      <div
        ref={pillRef}
        data-testid="floating-bar"
        data-status={visibleStatus}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        role={visibleStatus === 'hover' || visibleStatus === 'error' || visibleStatus === 'idle-hidden' ? 'button' : undefined}
        tabIndex={visibleStatus === 'hover' || visibleStatus === 'error' ? 0 : -1}
        onClick={() => { if (!preview && ['idle-hidden', 'hover', 'error'].includes(status)) click(status === 'error' ? 'retry' : 'start') }}
        onKeyDown={(event) => { if (!preview && (event.key === 'Enter' || event.key === ' ') && ['hover', 'error'].includes(status)) { event.preventDefault(); click(status === 'error' ? 'retry' : 'start') } }}
        aria-label="录音状态"
        style={{ ...BASE_STYLE, ...style, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', cursor: ['idle-hidden', 'hover', 'error'].includes(visibleStatus) ? 'pointer' : undefined }}
      >
        {['voice_command', 'translation'].includes(visibleMode) && <div className={`floating-mode-glow ${visibleMode === 'translation' ? 'is-translation' : ''}`} aria-hidden="true"><div /></div>}
        {visibleStatus === 'hover' && hover && <span className="floating-tooltip" role="tooltip">点击开始录音</span>}
        {(visibleStatus === 'hover' || visibleStatus === 'error') && <StatusIcons status={visibleStatus} />}
        {showWaveform && <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', height: 24, overflow: handsFree ? 'visible' : 'hidden' }}>
          {handsFree && <button className="floating-action" style={cancelButtonStyle} aria-label="取消听写" onClick={() => { if (!preview) click('cancel') }}><Icon name="close" size={16} /><span className="floating-tooltip" role="tooltip">取消</span></button>}
          <div style={{ width: 38, flexShrink: 0, margin: '0 8px' }}><Waveform analyser={recorder?.analyser ?? null} active width={38} /></div>
          {visibleCountdown && <span style={{ width: 32, marginRight: 8, flexShrink: 0, fontSize: 12, lineHeight: '16px', fontWeight: 400, color: '#fff' }}>{visibleCountdown}</span>}
          {handsFree && <button className="floating-action" style={finishButtonStyle} aria-label="完成听写" onClick={() => { if (!preview) click('finish') }}><Icon name="check" size={16} /><span className="floating-tooltip" role="tooltip">完成 <kbd>{hotkey.shortcutLabel}</kbd></span></button>}
        </div>}
        {refining && <RefiningContent />}
        {visibleStatus === 'starting-microphone' && <div style={shimmerOverlayStyle()} />}
      </div>
      {visibleMode === 'translation' && ['starting-microphone', 'recording', 'hands-free'].includes(visibleStatus) && <div ref={languageChoicesRef} className="floating-language-choices" role="group" aria-label="翻译目标">{settings.translationTargetLanguages.map(code => <button key={code} aria-pressed={settings.translationTargetLanguage === code} onClick={() => { if (!preview) void api.page.floatingBarClick('translation-language', code) }}>{new Intl.DisplayNames([settings.language ?? 'zh-CN'], { type: 'language' }).of(code) ?? code}</button>)}</div>}
      {hotkey.hint && !preview && <div style={hintStyle}>{hotkey.hint}</div>}
    </div>
  )
}

function computeStyle(status: BarStatus, hasCountdown: boolean): React.CSSProperties {
  const base: React.CSSProperties = { ...BASE_STYLE }
  if (status === 'idle-hidden' || status === 'long-pressing') return { ...base, opacity: 0 }
  const refining = status === 'recording-dictating' || status === 'hands-free-dictating'
  const handsFree = status === 'hands-free'
  const starting = status === 'starting-microphone'
  return {
    ...base,
    width: starting ? 54 : refining ? 92 : (handsFree ? SIZES.handsFreeWidth : SIZES.width) + (hasCountdown && status === 'recording' || hasCountdown && handsFree ? 40 : 0),
    height: starting ? 12 : SIZES.height,
    padding: handsFree || refining ? '4px' : '4px 6px',
    background: starting ? 'rgba(0,0,0,.5)' : '#000',
    opacity: 1,
    border: SIZES.border,
    boxShadow: status === 'hover' || status === 'error' ? BASE_STYLE.boxShadow : '0px 0px 20px 0px rgba(0, 0, 0, 0.15), 0px 25px 30px 0px rgba(0, 0, 0, 0.25)',
    transform: 'translateZ(0) scaleX(1) scaleY(1)',
    overflow: starting || refining ? 'hidden' : undefined,
    transition: refining ? 'width 0.2s ease-in-out' : BASE_STYLE.transition
  }
}

/** Progress timing from the original Thinking treatment; purely visual. */
function RefiningContent() {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const keyframes = [[0, 0], [1, 80], [2, 90], [3, 95], [4, 97], [5, 98], [10, 99]]
    const start = performance.now()
    let frame = 0
    const tick = () => {
      const time = (performance.now() - start) / 1000
      const i = keyframes.findIndex((point, index) => index < keyframes.length - 1 && time >= point[0] && time < keyframes[index + 1][0])
      setProgress(i < 0 ? 99 : keyframes[i][1] + (time - keyframes[i][0]) / (keyframes[i + 1][0] - keyframes[i][0]) * (keyframes[i + 1][1] - keyframes[i][1]))
      if (time < 10) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  return <>
    <div aria-hidden style={{ position: 'absolute', inset: 0, borderRadius: 16, overflow: 'hidden', pointerEvents: 'none' }}><div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress}%`, background: 'rgba(242,241,240,.25)' }} /></div>
    <div style={{ position: 'relative', zIndex: 1, width: 90, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ShimmerText active fontSize={14} fontWeight={450} lineHeight="16px" speed={64} shimmerWidth={24} waitMs={300} angle={90} dim="rgba(242,241,240,.5)" high="rgba(242,241,240,.3)" blur={3.4}>正在思考</ShimmerText></div>
  </>
}

const cancelButtonStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 24, height: 24, padding: 4, borderRadius: 12, background: '#424242', color: '#fff', transition: 'width .2s ease-in-out,height .2s ease-in-out,opacity .1s,transform .2s ease-in-out' }
const finishButtonStyle: React.CSSProperties = { ...cancelButtonStyle, background: '#fff', color: '#1d1a1a', zIndex: 2 }

const errorBubbleStyle: React.CSSProperties = {
  marginBottom: 12,
  padding: '8px 12px',
  borderRadius: 8,
  background: 'rgba(29, 26, 26, 1)',
  color: 'rgba(242, 241, 240, 1)',
  fontSize: 13,
  maxWidth: 360,
  boxShadow: '0px 25px 30px 0px rgba(0, 0, 0, 0.25), 0px 0px 20px 0px rgba(0, 0, 0, 0.15)'
}

const hintStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 11,
  color: 'rgba(242, 241, 240, 0.75)',
  textShadow: '0 1px 2px rgba(0,0,0,0.4)'
}

/** The blurred sweep used while the microphone spins up. */
function shimmerOverlayStyle(): React.CSSProperties {
  return {
    position: 'absolute',
    top: '50%',
    left: 0,
    marginTop: -13.5,
    width: 27,
    height: 27,
    background: 'rgb(242 241 240 / 25%)',
    borderRadius: '50%',
    filter: 'blur(10px)',
    animation: 'loadingMove 500ms cubic-bezier(0.42, 0, 0.58, 1) infinite',
    pointerEvents: 'none'
  }
}
