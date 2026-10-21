import { useEffect, useState } from 'react'
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import CheckRounded from '@mui/icons-material/CheckRounded'
import MicRounded from '@mui/icons-material/MicRounded'
import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded'
import { api } from '../shared/utils/bridge'
import { toast } from '../shared/components/Toast'
import { VoiceInstrument } from '../shared/components/VoiceInstrument'
import { startRecorder, type RecorderHandle } from '../floating-bar/audio'
import '../shared/styles/secondary.css'

// Keep permission, recording and shortcut semantics while sharing the paper UI.
const STEPS = ['permissions', 'microphone', 'shortcut', 'done'] as const
type Step = (typeof STEPS)[number]
export function OnboardingApp() {
  const [step, setStep] = useState<Step>('permissions')
  const [mic, setMic] = useState(false)
  const [accessibility, setAccessibility] = useState(false)
  const [shortcut, setShortcut] = useState('Fn')
  const [askShortcut, setAskShortcut] = useState('Fn+Space')
  const [level, setLevel] = useState(0)
  const [micReady, setMicReady] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [tested, setTested] = useState(false)
  useEffect(() => {
    const refresh = () => {
      api.permission.check('microphone').then(setMic).catch(() => undefined)
      api.permission.check('accessibility').then(setAccessibility).catch(() => undefined)
      api.settings.get().then((s: any) => { setShortcut(s?.shortcut?.accelerator || 'Fn'); setAskShortcut(s?.askAnythingShortcut?.accelerator || 'Fn+Space') }).catch(() => undefined)
    }
    refresh()
    window.addEventListener('focus', refresh)
    const interval = window.setInterval(refresh, 1000)
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(interval) }
  }, [])
  useEffect(() => {
    if (step !== 'microphone') return
    let cancelled = false
    let recorder: RecorderHandle | null = null
    setMicReady(false)
    api.settings.get().then((s: any) => startRecorder({ deviceId: s?.micDevice, onChunk: () => undefined, onLevel: setLevel })).then(async (handle: RecorderHandle) => {
      if (cancelled) { await handle.stop(); return }
      recorder = handle
      setMicReady(true)
    }).catch(() => { if (!cancelled) { toast.error("Microphone unavailable. Please check your settings.") } })
    return () => { cancelled = true; void recorder?.stop() }
  }, [step])
  useEffect(() => api.recording.onState((state: any) => {
    const active = state?.phase === 'recording' || state?.phase === 'starting'
    setPressed(active)
    if (active && state?.context?.mode === 'voice_transcript' && step === 'shortcut') setTested(true)
  }), [step])
  const index = STEPS.indexOf(step)
  const next = () => setStep(STEPS[Math.min(index + 1, STEPS.length - 1)])
  const back = () => setStep(STEPS[Math.max(0, index - 1)])
  return <main className="secondary-onboarding">
    <header className="secondary-onboarding-header drag"><div className="secondary-onboarding-brand"><img className="brand-lockup" src="./assets/brand/sayrel-horizontal.svg" alt="Sayrel" width={100} height={33} /></div><nav aria-label="Setup progress">{["Set up", "Try it out"].map((label, i) => <span className={i === (step === 'done' ? 1 : 0) ? 'active' : ''} key={label}>{label}{i < 1 && <ChevronRightRounded />}</span>)}</nav></header>
    <div className="secondary-onboarding-progress" style={{ width: `${(index + 1) * 25}%` }} />
    {step === 'done' ? <section className="secondary-onboarding-done"><h1><span>Speak,</span> don’t type</h1><div className="secondary-done-shortcuts"><ShortcutSummary title="Dictate" shortcut={shortcut} /><ShortcutSummary title="Ask anything" shortcut={askShortcut} /></div><button className="secondary-primary-button" onClick={() => void api.page.completeOnboarding()}>Let's go</button></section> : <div className="secondary-onboarding-layout">
      <section className="secondary-onboarding-left"><div className="secondary-onboarding-content">
        <div className="secondary-onboarding-back">{index > 0 && <button className="secondary-text-button" onClick={back}><ArrowBackRounded />Back</button>}</div>
        <div className={`secondary-onboarding-copy ${step === 'shortcut' ? 'shortcut-copy' : ''}`}>
          <p className="secondary-edition">0{index + 1} / {step === 'permissions' ? 'ACCESS' : step === 'microphone' ? 'VOICE INPUT' : 'SHORTCUT'}</p><h1>{step === 'permissions' ? (mic && accessibility ? <>Thank you for your trust.<br />Your privacy matters.</> : "Set up Sayrel on your computer") : step === 'microphone' ? "Speak to test your microphone" : <><span>Press your shortcut to try</span> dictation</>}</h1>
          {step === 'permissions' && <div className="secondary-permissions">
            <PermissionRow title="Allow Sayrel to paste text into any textbox" description="This lets Sayrel put your spoken words in the right textbox." help="Sayrel uses this to gather context based on the application you're using, and to access your clipboard temporarily to paste text." granted={accessibility} onGrant={async () => setAccessibility(await api.permission.request('accessibility'))} />
            <PermissionRow title="Allow Sayrel to use your microphone" description="Sayrel will only access the mic when you are actively using it." help="Sayrel will play a sound and show an animation when the mic is active. " collapsed={!accessibility} granted={mic} onGrant={async () => setMic(await api.permission.request('microphone'))} />
          </div>}
          {step === 'microphone' && <><p className="secondary-onboarding-description">Your computer's built-in mic will ensure optimal transcription.</p><p className="secondary-onboarding-question">Does the level move when you speak?</p></>}
          {step === 'shortcut' && <><p className="secondary-onboarding-description">We recommend the <kbd>{shortcut}</kbd> key, at the bottom left of your keyboard.</p><p className="secondary-onboarding-question">Does the shortcut light up when you press it?</p></>}
        </div>
        <footer className="secondary-onboarding-footer">
          {step === 'microphone' && <button className="secondary-outline-button" onClick={() => void api.page.openSettings('microphone')}>No, change microphone</button>}
          {step === 'shortcut' && <button className="secondary-outline-button" onClick={() => void api.page.openSettings('shortcuts')}>No, change shortcut</button>}
          {(step !== 'permissions' || (mic && accessibility)) && <button className="secondary-primary-button" disabled={step === 'microphone' ? !micReady : step === 'shortcut' ? !tested : false} onClick={next}>{step === 'permissions' ? "Continue" : "Yes, continue"}</button>}
        </footer>
      </div></section>
      <aside className={`secondary-onboarding-right ${step}-art`}>
        {step === 'permissions' && (accessibility ? <VoiceInstrument /> : <><img className="secondary-accessibility-art light-art" src="./assets/Ck6WD2NS.gif" alt="Accessibility permission settings" /><img className="secondary-accessibility-art dark-art" src="./assets/3oXgh2ks.gif" alt="Accessibility permission settings" /></>)}
        {step === 'microphone' && <div className="secondary-mic-test"><VoiceInstrument /><div className="secondary-volume-bars" role="meter" aria-label="Microphone level" aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100}><MicRounded />{Array.from({ length: 14 }, (_, i) => <i key={i} className={i < Math.ceil(Math.min(1, level * 4) * 14) ? 'active' : ''} />)}</div></div>}
        {step === 'shortcut' && <div className={`secondary-keyboard-panel ${pressed ? 'is-pressed' : ''}`}><div className="secondary-keyboard-grid" aria-hidden="true">{Array.from({length:36},(_,i)=><i key={i} />)}</div><div className={`secondary-shortcut-card ${pressed ? 'is-pressed' : ''}`}>{shortcut.split('+').map((key)=><kbd key={key}>{key}</kbd>)}</div><p>{pressed ? "Listening" : "Press your shortcut and start speaking"}</p></div>}
      </aside>
    </div>}
  </main>
}
function PermissionRow({ title, description, help, granted, collapsed, onGrant }: { title: string; description: string; help: string; granted: boolean; collapsed?: boolean; onGrant: () => void }) {
  const grant = async () => { try { await onGrant() } catch { toast.error("Could not request permission. Please try again.") } }
  return <section className="secondary-permission"><div className="secondary-permission-title"><h2>{title}</h2>{granted && <span className="secondary-permission-check"><CheckRounded /></span>}</div>{!granted && !collapsed && <><p>{description}</p><div className="secondary-permission-actions"><button className="secondary-primary-button secondary-permission-allow" onClick={() => void grant()}>Allow</button><span title={help} tabIndex={0} aria-label={help}><HelpOutlineRounded /></span></div></>}</section>
}
function ShortcutSummary({ title, shortcut }: { title: string; shortcut: string }) {
  return <div><h2>{title}</h2><div>{shortcut.split('+').map((key) => <kbd key={key}>{key}</kbd>)}</div></div>
}
