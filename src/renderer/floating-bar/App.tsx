import { useAppText } from '../shared/i18n/useAppText'
import { useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { DEFAULT_SETTINGS, type Settings } from '../../shared/settings'
import { recordingIssueSchema, recordingStateSchema, type RecordingIssue } from '../../shared/recordingFeedback'
import { api } from '../shared/utils/bridge'
import { Waveform } from './Waveform'
import { startRecorder, type RecorderHandle } from './audio'
import { RecorderSessionController } from './sessionController'
import { useHotkeyState } from './useHotkeyState'
import { ShimmerText } from './ShimmerText'
import { StatusIcons } from './StatusIcons'
import { recordingBarAppearance, handsFreeBarAppearance, cancelRecordingActionAppearance, finishRecordingActionAppearance } from './appearance'
import { Icon } from '../shared/components/Icons'
import { FloatingAlert } from './FloatingAlert'
import './styles.css'

const barPreviewSchema = z.object({
  status: z.enum(['idle-hidden', 'hover', 'starting-microphone', 'recording', 'recording-dictating', 'hands-free', 'hands-free-dictating', 'error', 'long-pressing']),
  countdown: z.string().optional(), error: z.string().optional(), mode: z.string().optional(), issue: recordingIssueSchema.optional()
})
type BarStatus = z.infer<typeof barPreviewSchema>['status']

const BASE_STYLE = {
  opacity: 0.5,
  background: recordingBarAppearance.background,
  width: 40,
  height: 6,
  borderRadius: recordingBarAppearance.borderRadius,
  boxShadow:
    recordingBarAppearance.boxShadow,
  transition: 'all 0.2s cubic-bezier(0.05, 0.6, 0.4, 0.95)',
  willChange: 'opacity, transform, background-color, width, height',
  backfaceVisibility: 'hidden' as const,
  transformOrigin: 'center' as const
}

const SIZES = {
  padX: 6,
  padY: 4,
  height: recordingBarAppearance.height,
  width: recordingBarAppearance.width,
  handsFreeWidth: handsFreeBarAppearance.width,
  border: recordingBarAppearance.border
}

export function FloatingBarApp() {
  const t = useAppText()
  const [status, setStatus] = useState<BarStatus>('idle-hidden')
  const [hover, setHover] = useState(false)
  const [countdown, setCountdown] = useState<string | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [issue, setIssue] = useState<RecordingIssue | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showHoverTip, setShowHoverTip] = useState(false)
  const alertRef = useRef<HTMLDivElement>(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const languageChoicesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    const off = window.sayrel?.on('store:changed', (next: Settings) => { if (live) setSettings(next) })
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
    const update = (value: unknown) => {
      const parsed = recordingStateSchema.safeParse(value)
      if (disposed || !parsed.success) return
      const state = parsed.data
      controller.sync(state)
      setIssue(state.context.issue ?? null)
      setActionError(null)
      if (state.context?.mode) setMode(state.context.mode)
      if (state.phase === 'starting') { setStatus('starting-microphone'); setErrorText(null) }
      if (state.phase === 'recording') setStatus(state.context?.handsFree ? 'hands-free' : 'recording')
      if (state.phase === 'finishing') setStatus(state.context?.handsFree ? 'hands-free-dictating' : 'recording-dictating')
      if (state.phase === 'idle') setStatus('idle-hidden')
      if (state.phase === 'long_pressing') setStatus('long-pressing')
      if (state.phase === 'error') { setStatus('error'); setErrorText(state.context?.error || "Transcription failed. Please try again.") }
      const timeout = state.context?.recorderTimeoutState
      if (timeout && timeout.remainingTime > 0 && timeout.timeUntilCountdown <= 0) {
        const total = Math.floor(timeout.remainingTime)
        setCountdown(`${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`)
      } else setCountdown(null)
    }
    const off = window.sayrel?.on?.('recording-machine:state', (state: unknown) => { receivedState = true; update(state) })
    void api.recording.state().then((state: unknown) => { if (!receivedState) update(state) }).catch(() => undefined)
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
      for (const element of [alertRef.current, languageChoicesRef.current]) {
        if (!element) continue
        const bounds = element.getBoundingClientRect()
        regions.push({ left: window.screenX + bounds.left, top: window.screenY + bounds.top, right: window.screenX + bounds.right, bottom: window.screenY + bounds.bottom })
      }
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
      setIssue(null)
      setErrorText(error instanceof Error ? error.message : "Could not update the recording status. Please try again.")
      setStatus('error')
    })
  }

  // Screenshot fixtures can display a state without starting a real recording.
  const [preview, setPreview] = useState<z.infer<typeof barPreviewSchema> | null>(null)
  useEffect(() => {
    if (document.documentElement.dataset.uiReview !== 'fixture') return
    const show = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const detail: unknown = event.detail
      if (detail === null) setPreview(null)
      else {
        const parsed = barPreviewSchema.safeParse(detail)
        if (parsed.success) setPreview(parsed.data)
      }
    }
    const params = new URLSearchParams(window.location.search)
    if (params.has('state')) show(new CustomEvent('sayrel:ui-review-floating-bar', { detail: {
      status: params.get('state'), mode: params.get('mode') ?? 'voice_transcript',
      countdown: params.get('countdown') ?? undefined,
      error: params.get('state') === 'error' ? "Microphone unavailable. Check system permissions and try again." : undefined
    } }))
    window.addEventListener('sayrel:ui-review-floating-bar', show)
    return () => window.removeEventListener('sayrel:ui-review-floating-bar', show)
  }, [])

  const visibleStatus = preview?.status ?? status
  const visibleCountdown = preview?.countdown ?? countdown
  const visibleError = preview?.error ?? errorText
  const visibleIssue = useMemo<RecordingIssue | null>(() => preview?.issue ?? issue ?? (visibleError ? { kind: 'processing', message: visibleError, canRetry: false } : null), [preview, issue, visibleError])
  const visibleMode = preview?.mode ?? mode
  const style = useMemo(() => computeStyle(visibleStatus, !!visibleCountdown), [visibleStatus, visibleCountdown])
  const refining = visibleStatus === 'recording-dictating' || visibleStatus === 'hands-free-dictating'
  const handsFree = visibleStatus === 'hands-free' || visibleStatus === 'hands-free-dictating'
  const showWaveform = visibleStatus === 'recording' || visibleStatus === 'hands-free'
  useEffect(() => {
    if (!hover || visibleStatus !== 'hover') { setShowHoverTip(false); return }
    const timer = window.setTimeout(() => setShowHoverTip(true), 250)
    return () => window.clearTimeout(timer)
  }, [hover, visibleStatus])
  const dismissAlert = () => {
    setActionError(null)
    if (preview) { setPreview(null); return }
    click('cancel')
  }
  const actOnIssue = async () => {
    if (!visibleIssue || actionBusy || preview) return
    setActionBusy(true)
    setActionError(null)
    try {
      if (visibleIssue.kind === 'provider-setup') {
        await api.page.openHub('/providers')
        await api.page.floatingBarClick('cancel')
      } else if (visibleIssue.kind === 'microphone') {
        await api.page.openHub('/settings')
        await api.page.floatingBarClick('cancel')
      } else {
        await api.page.floatingBarClick(visibleIssue.canRetry ? 'retry' : 'start')
      }
    } catch {
      setActionError('Could not open the next step. Please try again.')
    } finally { setActionBusy(false) }
  }
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
      <style>{t(`@keyframes loadingMove { 0% { transform: translateX(-27px); } 100% { transform: translateX(54px); } }`)}</style>
      {visibleStatus === 'error' && visibleIssue && <FloatingAlert issue={visibleIssue} busy={actionBusy} actionError={actionError} alertRef={alertRef} onDismiss={dismissAlert} onAction={() => void actOnIssue()} />}
      {visibleStatus === 'long-pressing' && <div role="status" style={errorBubbleStyle}>{t("Tap to start. Tap again to finish recording.")}</div>}
      <div
        ref={pillRef}
        data-testid="floating-bar"
        data-status={visibleStatus}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        role={visibleStatus === 'hover' || visibleStatus === 'error' || visibleStatus === 'idle-hidden' ? 'button' : undefined}
        tabIndex={visibleStatus === 'hover' || visibleStatus === 'error' ? 0 : -1}
        onClick={() => { if (!preview && ['idle-hidden', 'hover', 'error'].includes(status)) { if (status === 'error') void actOnIssue(); else click('start') } }}
        onKeyDown={(event) => { if (!preview && (event.key === 'Enter' || event.key === ' ') && ['hover', 'error'].includes(status)) { event.preventDefault(); if (status === 'error') void actOnIssue(); else click('start') } }}
        aria-label={t("Recording status")}
        style={{ ...BASE_STYLE, ...style, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', cursor: ['idle-hidden', 'hover', 'error'].includes(visibleStatus) ? 'pointer' : undefined }}
      >
        {['voice_command', 'translation'].includes(visibleMode) && <div className={`floating-mode-glow ${visibleMode === 'translation' ? 'is-translation' : ''}`} aria-hidden="true"><div /></div>}
        {showHoverTip && <span className="floating-tooltip" role="tooltip">{t("Click to start dictating")}</span>}
        {(visibleStatus === 'hover' || visibleStatus === 'error') && <StatusIcons status={visibleStatus} />}
        {(showWaveform || refining) && <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', height: 24, overflow: handsFree ? 'visible' : 'hidden' }}>
          {handsFree && <button className="floating-action" style={cancelButtonStyle} disabled={refining} aria-label={t("Cancel dictation")} onClick={() => { if (!preview) click('cancel') }}><Icon name="close" size={16} /><span className="floating-tooltip" role="tooltip">{t("Cancel")}</span></button>}
          {showWaveform && <div style={{ width: 38, flexShrink: 0, margin: '0 8px' }}><Waveform analyser={recorder?.analyser ?? null} active width={38} /></div>}
          {visibleCountdown && !refining && <span style={{ width: 32, marginRight: 8, flexShrink: 0, fontSize: 12, lineHeight: '16px', fontWeight: 400, color: 'var(--ink)' }}>{visibleCountdown}</span>}
          {refining && <RefiningContent />}
          {handsFree && <button className="floating-action" style={finishButtonStyle} disabled={refining} aria-label={t("Finish dictation")} onClick={() => { if (!preview) click('finish') }}><Icon name="check" size={16} /><span className="floating-tooltip" role="tooltip">{t("Finish")}<kbd>{hotkey.shortcutLabel}</kbd></span></button>}
        </div>}
        {visibleStatus === 'starting-microphone' && <div style={shimmerOverlayStyle()} />}
      </div>
      {visibleMode === 'translation' && ['starting-microphone', 'recording', 'hands-free'].includes(visibleStatus) && <div ref={languageChoicesRef} className="floating-language-choices" role="group" aria-label={t("Translation targets")}>{settings.translationTargetLanguages.map(code => <button key={code} aria-pressed={settings.translationTargetLanguage === code} onClick={() => { if (!preview) void api.page.floatingBarClick('translation-language', code) }}>{new Intl.DisplayNames([settings.language ?? 'en'], { type: 'language' }).of(code) ?? code}</button>)}</div>}
      {hotkey.hint && !preview && <div style={hintStyle}>{t(hotkey.hint)}</div>}
    </div>
  )
}

function computeStyle(status: BarStatus, hasCountdown: boolean): React.CSSProperties {
  const base: React.CSSProperties = { ...BASE_STYLE }
  if (status === 'idle-hidden' || status === 'long-pressing') return { ...base, opacity: 0 }
  const refining = status === 'recording-dictating' || status === 'hands-free-dictating'
  const handsFree = status === 'hands-free' || status === 'hands-free-dictating'
  const starting = status === 'starting-microphone'
  return {
    ...base,
    width: starting ? 54 : refining ? (handsFree ? SIZES.handsFreeWidth : SIZES.width + 12) : (handsFree ? SIZES.handsFreeWidth : SIZES.width) + (hasCountdown && status === 'recording' || hasCountdown && handsFree ? 40 : 0),
    height: starting ? 12 : SIZES.height,
    padding: handsFree || refining ? '4px' : '4px 6px',
    background: 'var(--paper)',
    opacity: 1,
    border: SIZES.border,
    boxShadow: status === 'hover' || status === 'error' ? BASE_STYLE.boxShadow : 'var(--shadow-popover)',
    transform: 'translateZ(0) scaleX(1) scaleY(1)',
    overflow: starting || refining ? 'hidden' : undefined,
    transition: refining ? 'width 0.2s ease-in-out' : BASE_STYLE.transition
  }
}

/** Progress timing from the original Thinking treatment; purely visual. */
function RefiningContent() {
  const t = useAppText()
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
    <div aria-hidden style={{ position: 'absolute', inset: 0, borderRadius: 8, overflow: 'hidden', pointerEvents: 'none' }}><div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress}%`, background: 'var(--fill-selected)' }} /></div>
    <div style={{ position: 'relative', zIndex: 1, flex: 1, minWidth: 0, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ShimmerText active fontSize={14} fontWeight={450} lineHeight="16px" speed={64} shimmerWidth={24} waitMs={300} angle={90} dim="var(--ink-tertiary)" high="var(--ink)" blur={3.4}>{t("Thinking")}</ShimmerText></div>
  </>
}

const cancelButtonStyle = cancelRecordingActionAppearance
const finishButtonStyle = finishRecordingActionAppearance

const errorBubbleStyle: React.CSSProperties = {
  marginBottom: 12,
  padding: '8px 12px',
  borderRadius: 8,
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontSize: 13,
  maxWidth: 360,
  boxShadow: 'var(--shadow-popover)'
}

const hintStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  color: 'var(--ink)',
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
    background: 'var(--fill-selected)',
    borderRadius: '50%',
    filter: 'blur(10px)',
    animation: 'loadingMove 500ms cubic-bezier(0.42, 0, 0.58, 1) infinite',
    pointerEvents: 'none'
  }
}
