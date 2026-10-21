import { useEffect, useState } from 'react'
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded'
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded'
import CheckRounded from '@mui/icons-material/CheckRounded'
import MicRounded from '@mui/icons-material/MicRounded'
import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded'
import { api } from '../shared/utils/bridge'
import { toast } from '../shared/components/Toast'
import { startRecorder, type RecorderHandle } from '../floating-bar/audio'
import '../shared/styles/secondary.css'

// Layout/permissions: DvUhSfBn:1280–1340, 1374–1455, 1595–1638.
// Shortcut and finish: 2XHPuyUf.js components va/re/Pa (shipped bundle).
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
    }).catch(() => { if (!cancelled) { toast.error('无法访问麦克风，请检查设置') } })
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
    <header className="secondary-onboarding-header drag"><nav aria-label="设置进度">{['注册', '设置', '体验一下'].map((label, i) => <span className={i === (step === 'done' ? 2 : 1) ? 'active' : ''} key={label}>{label}{i < 2 && <ChevronRightRounded />}</span>)}</nav></header>
    <div className="secondary-onboarding-progress" style={{ width: `${(index + 1) * 25}%` }} />
    {step === 'done' ? <section className="secondary-onboarding-done"><h1><span>说话，</span> 别打字</h1><div className="secondary-done-shortcuts"><ShortcutSummary title="语音输入" shortcut={shortcut} /><ShortcutSummary title="问任何问题" shortcut={askShortcut} /></div><button className="secondary-primary-button" onClick={() => void api.page.completeOnboarding()}>我们出发吧</button></section> : <div className="secondary-onboarding-layout">
      <section className="secondary-onboarding-left"><div className="secondary-onboarding-content">
        <div className="secondary-onboarding-back">{index > 0 && <button className="secondary-text-button" onClick={back}><ArrowBackRounded />返回</button>}</div>
        <div className={`secondary-onboarding-copy ${step === 'shortcut' ? 'shortcut-copy' : ''}`}>
          <h1>{step === 'permissions' ? (mic && accessibility ? '感谢您的信任，我们重视您的隐私' : '在您的计算机上设置 Offkey') : step === 'microphone' ? '口述以测试您的麦克风' : <><span>按下测试您的快捷键以</span> 听写</>}</h1>
          {step === 'permissions' && <div className="secondary-permissions">
            <PermissionRow title="允许 Offkey 将文本粘贴到任何文本框中" description="这让 Offkey 能够将您的口述内容放入正确的文本框中。" help="Offkey 使用此功能根据您正在使用的应用程序收集上下文，并暂时访问您的剪贴板以粘贴文本。" granted={accessibility} onGrant={async () => setAccessibility(await api.permission.request('accessibility'))} />
            <PermissionRow title="允许 Offkey 使用您的麦克风" description="Offkey 仅在您主动使用时访问麦克风。" help="当麦克风处于活动状态时，Offkey 会发出声音并显示动画。" collapsed={!accessibility} granted={mic} onGrant={async () => setMic(await api.permission.request('microphone'))} />
          </div>}
          {step === 'microphone' && <><p className="secondary-onboarding-description">您计算机内置的麦克风将确保最佳的转录效果。</p><p className="secondary-onboarding-question">您在说话时看到蓝色条形图在移动吗？</p></>}
          {step === 'shortcut' && <><p className="secondary-onboarding-description">我们推荐使用 <kbd>{shortcut}</kbd> 键，位于键盘左下角。</p><p className="secondary-onboarding-question">按下时，您看到按钮变蓝吗？</p></>}
        </div>
        <footer className="secondary-onboarding-footer">
          {step === 'microphone' && <button className="secondary-outline-button" onClick={() => void api.page.openSettings('microphone')}>不，换个麦克风</button>}
          {step === 'shortcut' && <button className="secondary-outline-button" onClick={() => void api.page.openSettings('shortcuts')}>不，修改快捷键</button>}
          {(step !== 'permissions' || (mic && accessibility)) && <button className="secondary-primary-button" disabled={step === 'microphone' ? !micReady : step === 'shortcut' ? !tested : false} onClick={next}>{step === 'permissions' ? '继续' : '是的，继续'}</button>}
        </footer>
      </div></section>
      <aside className={`secondary-onboarding-right ${step}-art`}>
        {step === 'permissions' && (accessibility ? <><img className="secondary-microphone-art light-art" src="./assets/B8YXZviC.png" alt="麦克风" /><img className="secondary-microphone-art dark-art" src="./assets/B2-LRdJC.png" alt="麦克风" /></> : <><img className="secondary-accessibility-art light-art" src="./assets/Ck6WD2NS.gif" alt="辅助功能权限设置" /><img className="secondary-accessibility-art dark-art" src="./assets/3oXgh2ks.gif" alt="辅助功能权限设置" /></>)}
        {step === 'microphone' && <div className="secondary-mic-test"><div className="secondary-volume-bars" role="meter" aria-label="麦克风音量" aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100}><MicRounded />{Array.from({ length: 14 }, (_, i) => <i key={i} className={i < Math.ceil(Math.min(1, level * 4) * 14) ? 'active' : ''} />)}</div></div>}
        {step === 'shortcut' && (shortcut.toLowerCase() === 'fn' ? <><img className="secondary-keyboard-art light-art" src={`./assets/${pressed ? 'Bt3eR-rj' : 'DFTEPrsg'}.webp`} alt="Fn 键" /><img className="secondary-keyboard-art dark-art" src={`./assets/${pressed ? 'CxW9ztGh' : 'CeKEbMYr'}.webp`} alt="Fn 键" /></> : <div className={`secondary-shortcut-card ${pressed ? 'is-pressed' : ''}`}>{shortcut.split('+').map((key) => <kbd key={key}>{key}</kbd>)}</div>)}
      </aside>
    </div>}
  </main>
}
function PermissionRow({ title, description, help, granted, collapsed, onGrant }: { title: string; description: string; help: string; granted: boolean; collapsed?: boolean; onGrant: () => void }) {
  const grant = async () => { try { await onGrant() } catch { toast.error('权限请求失败，请重试') } }
  return <section className="secondary-permission"><div className="secondary-permission-title"><h2>{title}</h2>{granted && <span className="secondary-permission-check"><CheckRounded /></span>}</div>{!granted && !collapsed && <><p>{description}</p><div className="secondary-permission-actions"><button className="secondary-primary-button secondary-permission-allow" onClick={() => void grant()}>允许</button><span title={help} tabIndex={0} aria-label={help}><HelpOutlineRounded /></span></div></>}</section>
}
function ShortcutSummary({ title, shortcut }: { title: string; shortcut: string }) {
  return <div><h2>{title}</h2><div>{shortcut.split('+').map((key) => <kbd key={key}>{key}</kbd>)}</div></div>
}
