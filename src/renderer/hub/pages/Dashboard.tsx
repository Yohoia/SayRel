import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { shortcutLabels } from '../../../shared/settingsControls'
import { api, bridge } from '../../shared/utils/bridge'
import { checkForUpdates } from '../../shared/utils/checkForUpdates'
import { toast } from '../../shared/components/Toast'
import { useAppSettings } from '../state/settings'
import { useRecordingPhase } from '../state/recording'

const APPLICATIONS = [
  { name: 'Gmail', url: 'https://mail.google.com/' },
  { name: 'Slack', url: 'https://app.slack.com/' },
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Notion', url: 'https://www.notion.so/' },
  { name: 'Google Docs', url: 'https://docs.google.com/' }
]
const historySchema = z.object({ items: z.array(z.object({
  duration: z.number().nullable(), refinedText: z.string().nullable()
})) })
const versionSchema = z.object({ appVersion: z.string() })
type Usage = { status: 'loading' } | { status: 'error' } | { status: 'ready'; minutes: number; words: number; count: number }
let hasEntered = false

export function DashboardPage() {
  const { settings, loaded } = useAppSettings()
  const [animateEntry] = useState(() => !hasEntered)
  const { phase } = useRecordingPhase()
  const [usage, setUsage] = useState<Usage>({ status: 'loading' })
  const [version, setVersion] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [activeShortcut, setActiveShortcut] = useState(0)
  const usageRequest = useRef(0)
  const mounted = useRef(false)
  const loadUsage = useCallback(async () => {
    const request = ++usageRequest.current
    setUsage({ status: 'loading' })
    try {
      const { items } = historySchema.parse(await api.history.list({ limit: 200 }))
      const segmenter = new Intl.Segmenter('en', { granularity: 'word' })
      const words = items.reduce((sum, item) => sum + Array.from(segmenter.segment(item.refinedText ?? '')).filter(part => part.isWordLike).length, 0)
      if (mounted.current && request === usageRequest.current) setUsage({ status: 'ready', count: items.length, minutes: Math.round(items.reduce((sum, item) => sum + (item.duration ?? 0), 0) / 60000), words })
    } catch {
      if (mounted.current && request === usageRequest.current) setUsage({ status: 'error' })
    }
  }, [])
  useEffect(() => {
    let active = true
    hasEntered = true
    mounted.current = true
    void loadUsage()
    void api.app.systemInfo().then((value: unknown) => {
      const result = versionSchema.safeParse(value)
      if (active && result.success) setVersion(result.data.appVersion)
    }).catch(() => undefined)
    const offHistory = bridge.on('history:changed', loadUsage)
    window.addEventListener('focus', loadUsage)
    return () => { active = false; mounted.current = false; offHistory?.(); window.removeEventListener('focus', loadUsage) }
  }, [loadUsage])
  const shortcuts = [
    { label: "Dictate", ordinal: '01', binding: settings.shortcut },
    { label: "Translate", ordinal: '02', binding: settings.translationShortcut },
    { label: "Ask anything", ordinal: '03', binding: settings.askAnythingShortcut }
  ]
  const openSettings = () => { void api.page.openSettings('settings').catch(() => toast.error("Could not open settings. Please try again.")) }
  return <div className={'home-canvas' + (animateEntry ? ' home-enter' : '')} data-recording-phase={phase}>
    <div className="home-composition">
      <section className="home-manifesto" aria-labelledby="home-title">
        <p className="home-eyebrow">AI-powered voice typing</p>
        <h1 className="page-title home-headline" id="home-title" aria-label="Speak more. Type less."><span>SPEAK MORE.</span><span>TYPE LESS.</span></h1>
        <p className="home-intro">Let expression feel as natural as conversation.</p>
        <div className="home-shortcuts" aria-label="Voice shortcuts" onMouseLeave={() => setActiveShortcut(0)}>
          <span className="home-shortcut-highlight" aria-hidden="true" style={{ transform: `translateY(${activeShortcut * 100}%)` }} />
          {shortcuts.map((shortcut, index) => <button key={shortcut.ordinal} className="home-shortcut" onMouseEnter={() => setActiveShortcut(index)} onFocus={() => setActiveShortcut(index)} onBlur={() => setActiveShortcut(0)} onClick={openSettings} title={`Change ${shortcut.label.toLowerCase()} shortcut`}>
            <span className="home-shortcut-name">{shortcut.label}<small>{shortcut.ordinal}</small></span>
            <span className="home-shortcut-binding">{!loaded ? <span>Loading</span> : !shortcut.binding.enabled ? <span>Disabled</span> : shortcutLabels(shortcut.binding.accelerator).map((key, keyIndex) => <kbd key={keyIndex}>{key === 'CommandOrControl' ? 'Command / Control' : key}</kbd>)}</span>
          </button>)}
        </div>
      </section>
      <figure className="home-instrument" aria-label="Blue astrolabe tracing voice into words">
        <div className="home-astrolabe"><img className="light-art" src="./assets/home/astrolabe.svg" alt="" width={500} height={500} /><img className="dark-art" src="./assets/home/astrolabe-dark.svg" alt="" width={500} height={500} /><span className="home-listening-ring" aria-hidden="true" /></div>
        <figcaption><span>SAYREL</span><span>Hold to speak.</span></figcaption>
      </figure>
    </div>
    <section className="home-applications" aria-label="Use Sayrel in your everyday apps">
      <p>IN THE APPS YOU KNOW</p>
      <div className="home-stamps">{APPLICATIONS.map((app, index) => <button key={app.name} className="home-stamp" onClick={() => void api.page.openUrl(app.url).catch(() => toast.error("Could not open the app. Please try again."))} aria-label={"Open " + app.name} title={"Open " + app.name}><span>{app.name}</span><small>0{index + 1}</small><span className="home-stamp-arrow" aria-hidden="true">↗</span></button>)}</div>
    </section>
    <footer className="home-footer">
      <div className="home-usage" aria-live="polite" title="Based on your latest 200 recordings">
        <span className="home-usage-label">RECENT ACTIVITY</span>
        {usage.status === 'ready' ? <><span><strong>{usage.minutes.toLocaleString()}</strong> min</span><span><strong>{usage.words.toLocaleString()}</strong> words</span>{usage.count === 0 && <span className="home-first-use">Start with your first dictation</span>}</> : usage.status === 'loading' ? <span>Loading…</span> : <><span>Stats unavailable</span><button onClick={() => void loadUsage()}>Retry</button></>}
      </div>
      <div className="home-version">{version && <span>v{version}</span>}<button disabled={checking || !version} onClick={async () => { if (!version) return; setChecking(true); try { await checkForUpdates(version) } finally { setChecking(false) } }}>{checking ? "Checking…" : "Check for updates"}</button></div>
    </footer>
  </div>
}
