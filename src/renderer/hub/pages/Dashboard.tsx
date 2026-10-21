import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../../shared/utils/bridge'
import { checkForUpdates } from '../../shared/utils/checkForUpdates'
import { Icon } from '../../shared/components/Icons'
import { useAppSettings } from '../state/settings'

const APPLICATIONS = [
  { name: 'Gmail', image: 'CotTEwvz.svg', description: "将口述的想法转化为精致、格式良好的邮件，听起来像你。", url: 'https://mail.google.com/' },
  { name: 'Slack', image: 'CrMLWYxm.webp', description: "分享清晰的团队更新，不打断你的思路。", url: 'https://app.slack.com/' },
  { name: 'ChatGPT', image: 'chatgpt.svg', description: "说出你的提示，快速获得更好的答案。", url: 'https://chatgpt.com/' },
  { name: 'Google Docs', image: 'BTKanheq.svg', description: "将口述的想法转化为清晰、结构化的写作。", url: 'https://docs.google.com/' },
  { name: 'WhatsApp', image: 'BYfssDPr.webp', description: "将快速的想法转化为自然的消息，听起来像你。", url: 'https://web.whatsapp.com/' },
  { name: 'Claude', image: 'D19j9GyN.webp', description: "头脑风暴并完善复杂的想法，无需打字。", url: 'https://claude.ai/' },
  { name: 'Notion', image: 'CzPJbMfN.webp', description: "捕捉想法并将其组织成清晰的笔记。", url: 'https://www.notion.so/' },
  { name: 'Line', image: 'C6gt8qzb.webp', description: "将快速的想法转化为更丰富、随时可发送的消息。", url: 'https://line.me/' },
  { name: 'Gemini', image: 'BaSTVbqz.svg', description: "通过说话进行头脑风暴、提问并获得答案。", url: 'https://gemini.google.com/' }
]

export function DashboardPage() {
  const { settings } = useAppSettings()
  const aside = useRef<HTMLElement>(null)
  const [anchor, setAnchor] = useState<{ left: number; width: number }>()
  useLayoutEffect(() => {
    const element = aside.current
    if (!element) return
    const update = () => { const { left, width } = element.getBoundingClientRect(); setAnchor({ left, width }) }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    window.addEventListener('resize', update)
    return () => { observer.disconnect(); window.removeEventListener('resize', update) }
  }, [])
  const [items, setItems] = useState<any[]>([])
  const [statsLoaded, setStatsLoaded] = useState(false)
  const [version, setVersion] = useState('1.0.0')
  const [checking, setChecking] = useState(false)
  useEffect(() => {
    let active = true
    Promise.all([api.history.list({ limit: 200 }), api.app.systemInfo()])
      .then(([list, info]) => { if (active) { setItems(list?.items ?? []); setVersion(info?.appVersion ?? '1.0.0'); setStatsLoaded(true) } }).catch(() => undefined)
    return () => { active = false }
  }, [])
  const duration = items.reduce((sum, item) => sum + (item.duration ?? 0), 0) / 60000
  const words = items.reduce((sum, item) => sum + (countWords(item.refinedText ?? '')), 0)
  const stats = [
    { icon: 'clock' as const, label: "总口述时间", value: Math.round(duration), unit: "分钟" },
    { icon: 'mic' as const, label: "口述字数", value: words, unit: "字" },
    { icon: 'bolt' as const, label: "平均口述速度", value: duration ? Math.round(words / duration) : 0, unit: "每分钟字数" },
    { icon: 'hourglass' as const, label: "节省时间", value: Math.max(0, Math.round(words / 40 - duration)), unit: "分钟" },
    { icon: 'personal' as const, label: "个性化", value: "--", unit: "" }
  ]
  return <div className="page home-page">
    <div className="home-ambience" aria-hidden="true" />
    <h1 className="page-title home-title">说话，不要打字</h1>
    <div className="home-columns">
      <div className="home-primary dotted-surface">
        <section className="shortcut-card" aria-label="语音快捷键">
          <Shortcut title="口述" description="杂乱的想法 → 清晰的文字" binding={settings.shortcut.accelerator} enabled={settings.shortcut.enabled} />
          <Shortcut title="翻译" description="自然的语言 → 清晰、地道的写作" binding={settings.translationShortcut.accelerator} enabled={settings.translationShortcut.enabled} />
          <Shortcut title="问任何问题" description="编辑或询问文本" binding={settings.askAnythingShortcut.accelerator} enabled={settings.askAnythingShortcut.enabled} accent="ask" />
        </section>
        <section className="use-cases" aria-labelledby="use-cases-title">
          <h2 id="use-cases-title">热门使用案例</h2>
          <div className="use-case-grid">{APPLICATIONS.map((app) => <button className="use-case-card" key={app.name} onClick={() => void api.page.openUrl(app.url)}>
            <div className="use-case-top"><img src={'./assets/' + app.image} alt="" width={32} height={32} /><span className="use-case-arrow"><Icon name="arrow" /></span></div>
            <h3>{app.name}</h3><p>{app.description}</p>
          </button>)}</div><div className="use-case-more"><button className="secondary-button" onClick={() => void api.page.openUrl('https://www.typeless.com/use-cases')}>查看全部<Icon name="arrow" size={14} /></button></div>
        </section>
      </div>
      <aside className="home-aside" ref={aside}>
        <section className="usage-stats" aria-label="使用统计">{stats.map((stat) => <div className="usage-stat" key={stat.label} title={stat.label}><Icon name={stat.icon} /><p className={!statsLoaded || !items.length || stat.value === "--" ? "is-default" : undefined}><strong>{!statsLoaded || !items.length ? "--" : stat.value.toLocaleString()}</strong><span>{!statsLoaded || !items.length ? "" : stat.unit}</span></p></div>)}</section>
        <button className="home-banner home-banner-referral" onClick={() => void api.page.openUrl('https://www.typeless.com/referral')}><div><h2>推荐朋友<span className="home-banner-arrow"><Icon name="arrow" /></span></h2><p>获得 <strong>$5 代金券</strong> 每个邀请。</p></div></button>
        <button className="home-banner home-banner-affiliate" onClick={() => void api.page.openUrl('https://www.typeless.com/affiliate')}><div><h2>联盟计划<span className="home-banner-arrow"><Icon name="arrow" /></span></h2><p>赚取 <strong>25%</strong> 重复佣金。</p></div></button>
        <footer className="app-version" style={anchor}><span>版本 v{version}</span><button disabled={checking} onClick={async () => { setChecking(true); try { await checkForUpdates(version) } finally { setChecking(false) } }}>{checking ? '正在检查…' : '检查更新'}</button></footer>
      </aside>
    </div>
  </div>
}

function Shortcut({ title, description, binding, enabled, accent, unavailable }: { title: string; description: string; binding: string; enabled: boolean; accent?: string; unavailable?: boolean }) {
  return <div className="shortcut-row"><div className="shortcut-copy"><h2>{title}</h2><p>{description}</p></div><div className={'shortcut-keys ' + (accent ?? '')}>{enabled ? binding.split('+').map((key, i) => <kbd key={key + i}>{key === 'Shift' ? 'Left Shift' : key}</kbd>) : <span className="muted" title={unavailable ? "当前版本暂不支持翻译" : undefined}>{unavailable ? "暂不可用" : "已停用"}</span>}</div></div>
}

export function formatRelative(iso: string | null): string {
  if (!iso) return '未知'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '未知'
  const minutes = Math.floor((Date.now() - then) / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`
  return new Date(iso).toLocaleDateString('zh-CN')
}

function countWords(text: string): number {
  return Array.from(new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text)).filter((part) => part.isWordLike).length
}
