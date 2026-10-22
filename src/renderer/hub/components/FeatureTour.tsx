import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { z } from 'zod'
import { TOUR_FEATURES, TOUR_STEPS, practiceResultSchema, type TourFeature, type TourStep } from '../../../shared/featureTour'
import { recordingStateSchema } from '../../../shared/recordingFeedback'
import type { SettingsTextKey } from '../../../shared/interfaceText'
import { api, bridge } from '../../shared/utils/bridge'
import { useAppSettings } from '../../shared/state/settings'
import { useAppText } from '../../shared/i18n/useAppText'
import { Modal } from '../../shared/components/Modal'
import { Icon } from '../../shared/components/Icons'
import { KeyCaps, SettingsDialog, ShortcutEditor, TranslationTargets } from './SettingsControls'
import { TOUR_CONTENT, practiceTarget, tourExample } from './featureTourContent'
import '../../shared/styles/feature-tour.css'

type TourView = { kind: 'closed' | 'picker' } | { kind: 'flow'; feature: TourFeature; index: number }
const TourContext = createContext<(() => void) | null>(null)
export function useFeatureTour() {
  const open = useContext(TourContext)
  if (!open) throw new Error('FeatureTourProvider is missing')
  return open
}

export function FeatureTourProvider({ children, onOpenProviders }: { children: ReactNode; onOpenProviders: () => void }) {
  const t = useAppText()
  const [view, setView] = useState<TourView>({ kind: 'closed' })
  const flow = view.kind === 'flow'
  useEffect(() => {
    if (!flow) return
    void bridge.invoke('page:set-hub-window-button-visibility', false).catch(() => undefined)
    return () => { void bridge.invoke('page:set-hub-window-button-visibility', true).catch(() => undefined) }
  }, [flow])
  const picker = () => setView({ kind: 'picker' })
  const providers = () => { setView({ kind: 'closed' }); onOpenProviders() }
  return <TourContext.Provider value={picker}>{children}{view.kind !== 'closed' && createPortal(
    <div className={`feature-tour settings-subdialog${flow ? ' is-flow' : ''}`}>
      <Modal title={view.kind === 'flow' ? t(TOUR_CONTENT[view.feature].title) : t('Explore key features')} dismissible={!flow} showClose={!flow} onClose={() => setView({ kind: 'closed' })}>
        {view.kind === 'picker' ? <>
          <p className="tour-picker-description">{t('Guided examples for Dictate, Translate, and Ask anything.', 'onboarding__explore_key_features__description')}</p>
          <div className="tour-feature-cards">{TOUR_FEATURES.map(feature => <article className="tour-feature-card" key={feature}>
            <div className="tour-feature-art" style={{ backgroundImage: `url(./assets/${TOUR_CONTENT[feature].image}.webp)` }}><TourIcon feature={feature} /></div>
            <div className="tour-feature-copy"><h3>{t(TOUR_CONTENT[feature].title)}</h3><p>{t('', TOUR_CONTENT[feature].descriptionKey)}</p></div>
            <button className="tour-button is-primary" onClick={() => setView({ kind: 'flow', feature, index: 0 })}>{t('Start', 'onboarding__explore_key_features__button__start')}</button>
          </article>)}</div>
        </> : view.kind === 'flow' && <>
          <div className="tour-progress" role="progressbar" aria-label={t('Setup progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.index / (TOUR_STEPS[view.feature].length - 1) * 100)}><i style={{ width: `${view.index / (TOUR_STEPS[view.feature].length - 1) * 100}%` }} /></div>
          <FeatureStep key={`${view.feature}:${view.index}`} feature={view.feature} step={TOUR_STEPS[view.feature][view.index]} onNext={() => setView({ ...view, index: Math.min(view.index + 1, TOUR_STEPS[view.feature].length - 1) })} onBack={view.index > 0 ? () => setView({ ...view, index: view.index - 1 }) : undefined} onFinish={picker} onProviders={providers} />
          {TOUR_STEPS[view.feature][view.index].kind !== 'done' && <button className="tour-button tour-exit" onClick={picker}><Icon name="arrow" size={12} />{t('Exit', 'onboarding__explore_key_features__button__exit')}</button>}
        </>}
      </Modal>
    </div>, document.body)}</TourContext.Provider>
}

function TourIcon({ feature }: { feature: TourFeature }) {
  return feature === 'dictate' ? <Icon name="mic" size={48} /> : feature === 'translate'
    ? <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M4 11h24M15 5v6m-6 6 12 12m0-18c-2 9-7 15-15 20m16 12 11-22 11 22m-18-9h14" stroke="currentColor" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    : <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 5c2 12 7 17 19 19-12 2-17 7-19 19C22 31 17 26 5 24c12-2 17-7 19-19Z" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" /></svg>
}

function TourTitle({ translationKey }: { translationKey: SettingsTextKey }) {
  const text = useAppText()('', translationKey)
  const parts = text.split(/<\/?0>/)
  return <h1>{parts.length === 3 ? <><span>{parts[1]}</span>{parts[2]}</> : text}</h1>
}

const shortcutEventSchema = z.object({ combination: z.string(), pressed: z.boolean() })
function sameShortcut(actual: string, expected: string) {
  if (actual === expected) return true
  return actual.split('+').map(part => expected.includes(part) ? part : part.replace(/^(Left|Right)(?=Shift|Control|Alt|Command)/, '')).sort().join('+') === expected.split('+').sort().join('+')
}

function FeatureStep({ feature, step, onNext, onBack, onFinish, onProviders }: {
  feature: TourFeature; step: TourStep; onNext: () => void; onBack?: () => void; onFinish: () => void; onProviders: () => void
}) {
  const t = useAppText()
  const { settings } = useAppSettings()
  const content = TOUR_CONTENT[feature]
  const binding = settings[content.shortcut]
  const [shortcutDialog, setShortcutDialog] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [tested, setTested] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [nativeCapture, setNativeCapture] = useState(true)
  const captureReady = useRef(false)
  useEffect(() => {
    if (step.kind === 'example') return
    void bridge.invoke('feature-tour:block').catch((error: unknown) => setCaptureError(error instanceof Error ? error.message : 'Finish the current recording first'))
    return () => { void api.featureTour.setTarget(null).catch(() => undefined) }
  }, [step.kind])
  useEffect(() => {
    if (step.kind !== 'shortcut' || shortcutDialog) return
    let disposed = false
    const off = bridge.on('keyboard:shortcut-captured', (raw: unknown) => {
      const event = shortcutEventSchema.safeParse(raw)
      if (disposed || !event.success || !sameShortcut(event.data.combination, binding.accelerator)) return
      setPressed(event.data.pressed)
      if (event.data.pressed) setTested(true)
    })
    void bridge.invoke('keyboard:begin-shortcut-capture').then((raw: unknown) => {
      const result = z.object({ native: z.boolean() }).parse(raw)
      if (!disposed) { setNativeCapture(result.native); captureReady.current = true }
    }).catch((error: unknown) => { if (!disposed) setCaptureError(error instanceof Error ? error.message : 'Could not record the shortcut. Please try again.') })
    return () => { disposed = true; captureReady.current = false; off(); void bridge.invoke('keyboard:end-shortcut-capture').catch(() => undefined) }
  }, [step.kind, shortcutDialog, binding.accelerator])
  useEffect(() => {
    if (step.kind !== 'shortcut' || nativeCapture || shortcutDialog) return
    const keydown = (event: KeyboardEvent) => {
      if (!captureReady.current) return
      const parts = [event.metaKey ? 'Command' : '', event.ctrlKey ? 'Control' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.getModifierState('Fn') ? 'Fn' : ''].filter(Boolean)
      if (!['Meta', 'Control', 'Alt', 'Shift', 'Fn', 'Unidentified'].includes(event.key)) parts.push(event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key)
      if (sameShortcut(parts.join('+'), binding.accelerator)) { event.preventDefault(); setPressed(true); setTested(true) }
    }
    const keyup = () => setPressed(false)
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup)
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup) }
  }, [step.kind, nativeCapture, shortcutDialog, binding.accelerator])

  const titleKey = feature === 'dictate' ? 'onboarding__dictation__start_page__title' : feature === 'translate' ? 'onboarding__translation__start_page__title' : 'onboarding__ask_anything__start_page__title'
  const shortcutTitleKey = feature === 'dictate' ? 'onboarding__setup__hotkey_test__title' : feature === 'translate' ? 'onboarding__translation__shortcut__title' : 'onboarding__ask_anything__shortcut__title'
  const shortcut = <span className="tour-keycaps"><KeyCaps value={binding.accelerator} /></span>
  return <section className={`tour-step tour-step-${step.kind}`} data-feature={feature} data-step={step.kind}>
    {onBack && <button className="tour-back" onClick={onBack}><Icon name="arrow" size={14} />{t('Back', 'onboarding__base__button__back')}</button>}
    {step.kind === 'intro' ? <div className="tour-intro">
      <TourTitle translationKey={titleKey} /><p>{t('You will be asked to read some brief samples.', 'onboarding__dictation__start_page__description')}</p>
      <button className="tour-button is-primary" onClick={onNext}>{t('Continue', 'onboarding__base__button__continue')}</button>
    </div> : step.kind === 'shortcut' ? <div className="tour-split">
      <div className="tour-copy"><TourTitle translationKey={shortcutTitleKey} /><p className="tour-lead">{t('', 'onboarding__setup__hotkey_test__description_prefix')}{shortcut}{t('', 'onboarding__setup__hotkey_test__description_suffix')}</p>
        <div className="tour-shortcut-question"><p>{t('Did the button turn blue when you pressed it?', 'onboarding__setup__hotkey_test__question')}</p>{captureError && <p role="alert">{t(captureError)}</p>}</div>
        <footer><button className="tour-button" onClick={() => setShortcutDialog(true)}>{t('No, change shortcut', 'onboarding__setup__hotkey_test__button_no')}</button><button className="tour-button is-primary" onClick={onNext}>{t('Yes, continue', 'onboarding__setup__hotkey_test__button_yes')}</button></footer>
      </div><div className="tour-art"><div className={`tour-shortcut-visual${pressed ? ' is-pressed' : ''}`} aria-live="polite">{shortcut}<p>{t(pressed ? 'Listening' : tested ? 'Shortcut tested' : 'Press your shortcut to try')}</p></div></div>
    </div> : step.kind === 'languages' ? <div className="tour-split"><div className="tour-copy"><h1>{t('Translate')}</h1><p className="tour-lead">{t('', 'onboarding__translation__settings__description')}</p><footer><button className="tour-button is-primary" onClick={onNext}>{t('Continue')}</button></footer></div><div className="tour-art"><div className="tour-language-card"><h2>{t('', 'onboarding__translation__settings_card__title')}</h2><TranslationTargets /></div></div></div>
    : step.kind === 'example' ? <PracticeExample feature={feature} index={step.index} onNext={onNext} onProviders={onProviders} />
    : step.kind === 'done' && <div className="tour-done"><TourTitle translationKey="onboarding__good_to_go__title" /><div className="tour-done-shortcuts">{TOUR_FEATURES.map(item => <div key={item}><h2>{t(TOUR_CONTENT[item].title)}</h2><span className="tour-keycaps"><KeyCaps value={settings[TOUR_CONTENT[item].shortcut].accelerator} /></span></div>)}</div><button className="tour-button is-primary" onClick={onFinish}>{t('Finish', 'onboarding__explore_key_features__button__finish')}</button></div>}
    {shortcutDialog && <div className="tour-shortcut-dialog"><SettingsDialog title="Change shortcut" onClose={() => setShortcutDialog(false)}><ShortcutEditor settingKey={content.shortcut} /><button className="tour-button is-primary" onClick={() => setShortcutDialog(false)}>{t('Done')}</button></SettingsDialog></div>}
  </section>
}

function PracticeExample({ feature, index, onNext, onProviders }: { feature: TourFeature; index: number; onNext: () => void; onProviders: () => void }) {
  const t = useAppText()
  const { settings, locale } = useAppSettings()
  const example = tourExample(feature, index, locale.startsWith('zh'))
  const id = useId()
  const target = useRef(practiceTarget(feature, index, id, example.selectedText))
  const [ready, setReady] = useState(false)
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState<string | null>(null)
  const [setupRequired, setSetupRequired] = useState(false)
  const [text, setText] = useState(example.selectedText)
  const [answer, setAnswer] = useState('')
  const [transcript, setTranscript] = useState('')
  const [completed, setCompleted] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const selection = useRef({ start: 0, end: example.selectedText.length })
  const currentText = useRef(text)
  currentText.current = text
  const active = phase === 'starting' || phase === 'recording'
  const processing = phase === 'finishing'
  useEffect(() => {
    let disposed = false
    const offState = api.recording.onState((raw: unknown) => {
      const state = recordingStateSchema.safeParse(raw)
      if (disposed || !state.success || state.data.context.mode !== TOUR_CONTENT[feature].mode) return
      setPhase(state.data.phase)
      setSetupRequired(state.data.context.issue?.kind === 'provider-setup')
      setError(state.data.phase === 'error' ? state.data.context.error ?? 'Recording error' : null)
    })
    const offResult = api.featureTour.onResult(raw => {
      const result = practiceResultSchema.safeParse(raw)
      if (disposed || !result.success || result.data.targetId !== id) return
      setTranscript(result.data.transcript)
      if (target.current.kind === 'question') setAnswer(result.data.text)
      else if (target.current.kind === 'rewrite') {
        const { start, end } = selection.current
        setText(currentText.current.slice(0, start) + result.data.text + currentText.current.slice(end))
      } else setText(result.data.text)
      setCompleted(true)
    })
    void api.featureTour.setTarget(target.current).then(() => {
      if (disposed) return
      setReady(true)
      input.current?.focus()
      if (example.selectedText && target.current.kind === 'rewrite') input.current?.select()
    }).catch((error: unknown) => { if (!disposed) setError(error instanceof Error ? error.message : 'Could not update the recording status. Please try again.') })
    return () => { disposed = true; offState(); offResult(); void api.featureTour.setTarget(null).catch(() => undefined) }
  }, [feature, id, example.selectedText])
  const start = async () => {
    try {
      if (active) await bridge.invoke('feature-tour:finish')
      else await api.featureTour.start()
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not update the recording status. Please try again.') }
  }
  const updateSelection = () => {
    const element = input.current
    if (!element || !('selectedText' in target.current) || element.selectionEnd === element.selectionStart) return
    selection.current = { start: element.selectionStart, end: element.selectionEnd }
    target.current = { ...target.current, selectedText: element.value.slice(element.selectionStart, element.selectionEnd) }
    void api.featureTour.setTarget(target.current).catch(() => undefined)
  }
  const binding = settings[TOUR_CONTENT[feature].shortcut]
  return <div className="tour-split tour-practice" data-completed={completed}>
    <div className="tour-copy"><div className="tour-practice-heading"><h1>{t(TOUR_CONTENT[feature].title)}</h1><span className="tour-keycaps"><KeyCaps value={binding.accelerator} /></span></div>
      <p className="tour-lead">{t(feature === 'askAnything' ? index === 0 ? 'Speak to edit selected text.' : index === 1 ? 'Speak to ask about selected text.' : 'Speak to get quick answers or take quick actions.' : 'Dictate the message into the textbox.')}</p>
      <div className="tour-read-card"><p>{t('Press your shortcut once, read the message below, then press it again to finish.')}</p><blockquote>{example.prompt}</blockquote></div>
      {feature === 'askAnything' && index < 2 && <p className="tour-selection-hint">{t('Select all the text in the textbox.', 'onboarding__try_it__select_all_text_instruction')}</p>}
      {error && <div className="tour-practice-error" role="alert"><p>{t(error)}</p>{setupRequired && <button className="tour-button" onClick={onProviders}>{t('Open Providers')}</button>}</div>}
      <footer><button className="tour-button" disabled={!ready || processing || !binding.enabled} onClick={() => void start()}>{t(processing ? 'Thinking' : active ? 'Finish' : 'Start speaking')}</button><button className="tour-button is-primary" disabled={active || processing} onClick={onNext}>{t('Continue', 'onboarding__try_it__button__continue')}</button></footer>
    </div>
    <div className="tour-art"><div className="tour-playground"><div className="tour-playground-title"><TourIcon feature={feature} /><span>{t(feature === 'dictate' ? index === 1 ? 'Email' : index >= 2 ? 'Notes' : 'Message' : feature === 'translate' ? 'Translation' : 'Selected text')}</span></div>
      {feature === 'askAnything' && index === 1 ? <div className="tour-selected-article" tabIndex={0}>{example.selectedText}</div> : feature === 'askAnything' && index === 2 ? <div className="tour-answer-placeholder"><TourIcon feature={feature} /><p>{t('Ask anything')}</p></div> : <textarea ref={input} aria-label={t('Practice text')} value={text} onChange={event => setText(event.target.value)} onSelect={updateSelection} placeholder={t('Press your shortcut and start speaking')} />}
      {transcript && <p className="tour-transcript">{transcript}</p>}
      {answer && <div className="tour-answer" role="status"><h2>{t('Answer')}</h2><p>{answer}</p></div>}
      {completed && <div className="tour-practice-feedback" role="status"><Icon name="check" size={18} /><span>{t('Practice complete')}</span></div>}
      {completed && example.features.length > 0 && <ul className="tour-capabilities">{example.features.map(item => <li key={item}><Icon name="check" size={16} />{t(item)}</li>)}</ul>}
    </div></div>
  </div>
}
