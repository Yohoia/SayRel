import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
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
      const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
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
    { label: '口述', ordinal: '01', binding: settings.shortcut },
    { label: '翻译', ordinal: '02', binding: settings.translationShortcut },
    { label: '问任何问题', ordinal: '03', binding: settings.askAnythingShortcut }
  ]
  const openSettings = () => { void api.page.openSettings('settings').catch(() => toast.error('无法打开设置，请重试')) }
  return <div className={'home-canvas' + (animateEntry ? ' home-enter' : '')} data-recording-phase={phase}>
    <div className="home-composition">
      <section className="home-manifesto" aria-labelledby="home-title">
        <p className="home-eyebrow">VOICE INTO WORDS</p>
        <h1 className="page-title home-headline" id="home-title" aria-label="Speak. Leave your mark."><span>SPEAK.</span><span>LEAVE</span><span>YOUR MARK.</span></h1>
        <p className="home-intro">说出脑海里的想法，<br />让文字留下你的笔迹。</p>
        <div className="home-shortcuts" aria-label="语音快捷键" onMouseLeave={() => setActiveShortcut(0)}>
          <span className="home-shortcut-highlight" aria-hidden="true" style={{ transform: `translateY(${activeShortcut * 100}%)` }} />
          {shortcuts.map((shortcut, index) => <button key={shortcut.ordinal} className="home-shortcut" onMouseEnter={() => setActiveShortcut(index)} onFocus={() => setActiveShortcut(index)} onBlur={() => setActiveShortcut(0)} onClick={openSettings} title={'设置' + shortcut.label + '快捷键'}>
            <span className="home-shortcut-name">{shortcut.label}<small>{shortcut.ordinal}</small></span>
            <span className="home-shortcut-binding">{!loaded ? <span>读取中</span> : !shortcut.binding.enabled ? <span>已停用</span> : shortcut.binding.accelerator.split('+').map((key, keyIndex) => <kbd key={keyIndex}>{key === 'CommandOrControl' ? '⌘ / Ctrl' : key}</kbd>)}</span>
          </button>)}
        </div>
      </section>
      <figure className="home-instrument" aria-label="蓝墨星盘：声音成为文字的轨迹">
        <div className="home-astrolabe"><img className="light-art" src="./assets/home/astrolabe.svg" alt="" width={500} height={500} /><img className="dark-art" src="./assets/home/astrolabe-dark.svg" alt="" width={500} height={500} /><span className="home-listening-ring" aria-hidden="true" /></div>
        <figcaption><span>OFFKEY / VOICE — TEXT</span><span>让声音落在纸上</span></figcaption>
      </figure>
    </div>
    <section className="home-applications" aria-label="在常用应用中使用 Offkey">
      <p>在你熟悉的应用里</p>
      <div className="home-stamps">{APPLICATIONS.map((app, index) => <button key={app.name} className="home-stamp" onClick={() => void api.page.openUrl(app.url).catch(() => toast.error('无法打开应用，请重试'))} aria-label={'打开 ' + app.name} title={'打开 ' + app.name}><span>{app.name}</span><small>0{index + 1}</small><span className="home-stamp-arrow" aria-hidden="true">↗</span></button>)}</div>
    </section>
    <footer className="home-footer">
      <div className="home-usage" aria-live="polite" title="统计最近 200 条记录">
        <span className="home-usage-label">最近记录</span>
        {usage.status === 'ready' ? <><span><strong>{usage.minutes.toLocaleString()}</strong>分钟</span><span><strong>{usage.words.toLocaleString()}</strong>字</span>{usage.count === 0 && <span className="home-first-use">从一次口述开始</span>}</> : usage.status === 'loading' ? <span>读取中…</span> : <><span>统计暂不可用</span><button onClick={() => void loadUsage()}>重试</button></>}
      </div>
      <div className="home-version">{version && <span>v{version}</span>}<button disabled={checking || !version} onClick={async () => { if (!version) return; setChecking(true); try { await checkForUpdates(version) } finally { setChecking(false) } }}>{checking ? '检查中…' : '检查更新'}</button></div>
    </footer>
  </div>
}
