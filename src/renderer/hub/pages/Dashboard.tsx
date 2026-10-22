import { useAppText } from '../../shared/i18n/useAppText'
import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { shortcutLabels } from '../../../shared/settingsControls'
import { api, bridge } from '../../shared/utils/bridge'
import { toast } from '../../shared/components/Toast'
import { useAppSettings } from '../../shared/state/settings'
import { useRecordingPhase } from '../state/recording'
import { ActivityHeatmap } from '../components/ActivityHeatmap'
import { buildActivity, historyActivitySchema, type ActivitySummary } from '../../../shared/activity'
import { dictationUsageSchema, type DictationUsage } from '../../../shared/usage'

const APPLICATIONS = [
  { name: 'Gmail', url: 'https://mail.google.com/' },
  { name: 'Slack', url: 'https://app.slack.com/' },
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Notion', url: 'https://www.notion.so/' },
  { name: 'Google Docs', url: 'https://docs.google.com/' }
]
const versionSchema = z.object({ appVersion: z.string() })
type Usage = { status: 'loading' } | { status: 'error' } | { status: 'ready'; stats: DictationUsage; activity: ActivitySummary }
let hasEntered = false

export function DashboardPage() {
  const t = useAppText()
  const { settings, loaded } = useAppSettings()
  const [animateEntry] = useState(() => !hasEntered)
  const { phase } = useRecordingPhase()
  const [usage, setUsage] = useState<Usage>({ status: 'loading' })
  const [version, setVersion] = useState<string | null>(null)
  const [activeShortcut, setActiveShortcut] = useState(0)
  const usageRequest = useRef(0)
  const mounted = useRef(false)
  const loadUsage = useCallback(async () => {
    const request = ++usageRequest.current
    setUsage(current => current.status === 'ready' ? current : { status: 'loading' })
    try {
      const [usageResult, activityResult] = await Promise.all([api.history.usage(), api.history.activity()])
      const stats = dictationUsageSchema.parse(usageResult)
      const activity = buildActivity(historyActivitySchema.parse(activityResult))
      if (mounted.current && request === usageRequest.current) setUsage({ status: 'ready', activity, stats })
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
        <h1 className="page-title home-headline" id="home-title" aria-label={t("Speak more. Type less.")}><span>{t("SPEAK MORE.")}</span><span>{t("TYPE LESS.")}</span></h1>
        <p className="home-intro">{t("Let expression feel as natural as conversation.")}</p>
        <div className="home-shortcuts" aria-label={t("Voice shortcuts")} onMouseLeave={() => setActiveShortcut(0)}>
          <span className="home-shortcut-highlight" aria-hidden="true" style={{ transform: `translateY(${activeShortcut * 100}%)` }} />
          {shortcuts.map((shortcut, index) => <button key={shortcut.ordinal} className="home-shortcut" onMouseEnter={() => setActiveShortcut(index)} onFocus={() => setActiveShortcut(index)} onBlur={() => setActiveShortcut(0)} onClick={openSettings} title={t(`Change ${t(shortcut.label)} shortcut`)}>
            <span className="home-shortcut-name">{t(shortcut.label)}<small>{shortcut.ordinal}</small></span>
            <span className="home-shortcut-binding">{!loaded ? <span>{t("Loading")}</span> : !shortcut.binding.enabled ? <span>{t("Disabled")}</span> : shortcutLabels(shortcut.binding.accelerator).map((key, keyIndex) => <kbd key={keyIndex}>{key === 'CommandOrControl' ? t('Command / Control') : key}</kbd>)}</span>
          </button>)}
        </div>
      </section>
      <ActivityHeatmap state={usage} onRetry={() => void loadUsage()} />
    </div>
    <section className="home-applications" aria-label={t("Use Sayrel in your everyday apps")}>
      <p>{t("IN THE APPS YOU KNOW")}</p>
      <div className="home-stamps">{APPLICATIONS.map((app, index) => <button key={app.name} className="home-stamp" onClick={() => void api.page.openUrl(app.url).catch(() => toast.error("Could not open the app. Please try again."))} aria-label={t("Open " + app.name)} title={t("Open " + app.name)}><span>{app.name}</span><small>0{index + 1}</small><span className="home-stamp-arrow" aria-hidden="true">↗</span></button>)}</div>
    </section>
    <footer className="home-footer">
      <span className="home-credit">Builded By Yohoia</span>
      <div className="home-version">{version && <span>v{version}</span>}</div>
    </footer>
  </div>
}
