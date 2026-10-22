import { useEffect, useRef, useState } from 'react'
import { useAppText } from '../../shared/i18n/useAppText'
import { shortcutLabels } from '../../../shared/settingsControls'
import { api } from '../../shared/utils/bridge'
import { toast } from '../../shared/components/Toast'
import { useAppSettings } from '../../shared/state/settings'
import { SpeechFlow } from '../components/SpeechFlow'
import { HomeFooter } from '../components/HomeFooter'
import { Icon } from '../../shared/components/Icons'

let hasEntered = false

export function DashboardPage() {
  const canvas = useRef<HTMLDivElement>(null)
  const t = useAppText()
  const { settings, loaded } = useAppSettings()
  const [animateEntry] = useState(() => !hasEntered)
  useEffect(() => { hasEntered = true }, [])
  useEffect(() => {
    const page = canvas.current
    const shortcuts = page?.querySelector<HTMLElement>('.home-shortcuts')
    const flow = page?.querySelector<HTMLElement>('.home-speech-flow')
    const footer = page?.querySelector<HTMLElement>('.home-footer')
    if (!page || !shortcuts || !flow || !footer) return
    const alignShortcuts = () => {
      if (innerWidth <= 680) { page.style.removeProperty('--home-shortcut-shift'); return }
      const pill = [...flow.querySelectorAll<SVGPathElement>('path[fill="rgb(254,254,233)"]')]
        .map(path => path.getBoundingClientRect()).find(rect => rect.height > 0)
      if (!pill) return
      const row = shortcuts.getBoundingClientRect()
      const previous = parseFloat(page.style.getPropertyValue('--home-shortcut-shift')) || 0
      const naturalTop = row.top - previous
      const targetTop = (pill.bottom + footer.getBoundingClientRect().top - row.height) / 2
      page.style.setProperty('--home-shortcut-shift', `${Math.max(0, targetTop - naturalTop)}px`)
    }
    const resize = new ResizeObserver(alignShortcuts)
    ;[page, shortcuts, flow, footer, ...page.querySelectorAll('.home-headline,.home-intro')].forEach(el => resize.observe(el))
    const ready = new MutationObserver(alignShortcuts)
    ready.observe(flow, { attributes: true, attributeFilter: ['data-ready'] })
    page.addEventListener('animationend', alignShortcuts)
    alignShortcuts()
    return () => { resize.disconnect(); ready.disconnect(); page.removeEventListener('animationend', alignShortcuts) }
  }, [])
  const shortcuts = [
    { label: "Dictate", ordinal: '01', binding: settings.shortcut },
    { label: "Translate", ordinal: '02', binding: settings.translationShortcut },
    { label: "Ask anything", ordinal: '03', binding: settings.askAnythingShortcut }
  ]
  const openSettings = () => { void api.page.openSettings('settings').catch(() => toast.error("Could not open settings. Please try again.")) }
  return <div ref={canvas} className={'home-canvas' + (animateEntry ? ' home-enter' : '')}>
    <div className="home-composition">
      <section className="home-manifesto" aria-labelledby="home-title">
        <h1 className="page-title home-headline" id="home-title" aria-label={t('Speak freely. Write brilliantly.')}><span>{t('Speak freely.')}</span><span>{t('Write brilliantly.')}</span></h1>
        <p className="home-intro"><svg className="home-intro-ornament is-left" aria-hidden="true" viewBox="0 0 54 32" fill="none"><path d="M1 16h11m8-4v8m7-12v16m7-11v6m8-3h11" /></svg><span className="home-intro-positioning">{t('SayRel, the next-gen AI voice tool')}</span><span className="home-intro-separator">—</span><span className="home-intro-benefit">{t('turning your raw thoughts into polished text in real time.')}</span><svg className="home-intro-ornament is-right" aria-hidden="true" viewBox="0 0 54 32" fill="none"><path d="M1 16h11m8-4v8m7-12v16m7-11v6m8-3h11" /></svg></p>
        <SpeechFlow />
        <div className="home-shortcuts" aria-label={t("Voice shortcuts")}>
          {shortcuts.map((shortcut, index) => <button key={shortcut.ordinal} className="home-shortcut" onClick={openSettings} title={t(`Change ${t(shortcut.label)} shortcut`)}>
            <span className="home-shortcut-binding">{!loaded ? <span>{t("Loading")}</span> : !shortcut.binding.enabled ? <span>{t("Disabled")}</span> : shortcutLabels(shortcut.binding.accelerator).map((key, keyIndex) => <span className="home-shortcut-key" key={keyIndex}>{keyIndex > 0 && <span className="home-key-plus" aria-hidden="true">+</span>}<kbd>{key === 'CommandOrControl' ? t('Command / Control') : key}</kbd></span>)}</span>
            <span className="home-shortcut-copy"><span className="home-shortcut-name">{t(shortcut.label)}</span>{index === 0 && <span className="home-shortcut-detail">{t('Press your shortcut, then speak.')}</span>}</span>
            <Icon name="arrow" className="home-shortcut-arrow" />
          </button>)}
        </div>
      </section>
    </div>
    <HomeFooter />
  </div>
}
