import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { Settings } from '../../shared/settings'
import { english } from '../../shared/interfaceText'
import { api } from '../shared/utils/bridge'
import { useAppText } from '../shared/i18n/useAppText'
import { toast } from '../shared/components/Toast'
import { VolumeGlow } from './VolumeGlow'

export function ModeIndicator({ mode, settings, volume, indicatorRef, menuRef }: {
  mode: string
  settings: Settings
  volume: number
  indicatorRef: RefObject<HTMLDivElement>
  menuRef: RefObject<HTMLDivElement>
}) {
  const t = useAppText()
  const [open, setOpen] = useState(false)
  const [onboarding, setOnboarding] = useState(true)
  const [width, setWidth] = useState<number>()
  const measureRef = useRef<HTMLDivElement>(null)
  const selected = settings.translationTargetLanguage
  const label = (code: string) => {
    const source = english[`language_selector__option__${code.toLowerCase().replaceAll('-', '_')}`]
    return source ? t(source) : new Intl.DisplayNames([settings.language ?? 'en'], { type:'language' }).of(code) ?? code
  }
  const activeLabel = label(selected)
  useEffect(() => {
    if (mode !== 'translation') return
    let live = true
    void api.page.isOnboardingVisible().then(visible => { if (live) setOnboarding(visible) }).catch(() => undefined)
    return () => { live = false }
  }, [mode])
  useLayoutEffect(() => {
    const measure = measureRef.current
    if (!measure) return
    const update = () => setWidth(Math.ceil(measure.offsetWidth) + 2)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(measure)
    return () => observer.disconnect()
  }, [activeLabel, t])

  const choose = async (code: string) => {
    setOpen(false)
    if (code === selected) return
    try { await api.page.floatingBarClick('translation-language', code) }
    catch { toast.error('Could not change the translation language. Please try again.') }
  }

  if (mode !== 'translation') return <div ref={indicatorRef} className="floating-mode-indicator floating-ask-indicator" role="status">
    <span>{t('Ask anything')}</span><VolumeGlow volume={volume} />
  </div>

  const targets = [selected, ...settings.translationTargetLanguages.filter(code => code !== selected)].reverse()
  const canAdd = targets.length < 3 && !onboarding
  const closeOutside = (event: React.MouseEvent) => {
    if (event.relatedTarget instanceof Node && (indicatorRef.current?.contains(event.relatedTarget) || menuRef.current?.contains(event.relatedTarget))) return
    setOpen(false)
  }
  return <div ref={indicatorRef} className="floating-mode-indicator floating-translation-indicator" onMouseLeave={closeOutside}>
    <div className="floating-translation-panel floating-translation-measure" ref={measureRef} aria-hidden="true">
      <span>{t('Translating to')}</span><div className="floating-language-anchor"><button type="button" tabIndex={-1} className="floating-language-trigger"><span>{activeLabel}</span><LanguageArrows /></button></div>
    </div>
    <div className="floating-translation-panel" style={{ width }}>
      <VolumeGlow volume={volume} />
      <span>{t('Translating to')}</span>
      <div className="floating-language-anchor">
        <button type="button" className="floating-language-trigger" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? 'translation-target-language-popover' : undefined}
          onMouseEnter={() => { setOpen(true); void api.page.isOnboardingVisible().then(setOnboarding).catch(() => undefined) }} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
          <span>{activeLabel}</span><LanguageArrows />
        </button>
        {open && <div ref={menuRef} id="translation-target-language-popover" className="floating-language-choices" role="menu" aria-label={t('Translation targets')} onMouseLeave={closeOutside}>
          {canAdd && <><button type="button" role="menuitem" onClick={() => {
            setOpen(false)
            void api.page.openSettings('translation').catch(() => toast.error('Could not open the next step. Please try again.'))
          }}><span>{t('Add another language')}</span></button><div className="floating-language-divider" /></>}
          {targets.map(code => <button type="button" role="menuitemradio" aria-checked={selected === code} key={code} onClick={() => void choose(code)}><span>{label(code)}</span></button>)}
        </div>}
      </div>
    </div>
  </div>
}

function LanguageArrows() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9.70113 8.4513C9.93544 8.21699 10.3145 8.21699 10.5488 8.4513C10.7831 8.68562 10.7831 9.06464 10.5488 9.29896L7.42378 12.424C7.18947 12.6583 6.81044 12.6583 6.57613 12.424L3.45113 9.29896C3.21681 9.06464 3.21681 8.68562 3.45113 8.4513C3.68544 8.21699 4.06447 8.21699 4.29878 8.4513L6.99995 11.1525L9.70113 8.4513ZM6.66988 1.49915C6.90277 1.34536 7.21875 1.37127 7.42378 1.5763L10.5488 4.7013C10.7831 4.93562 10.7831 5.31464 10.5488 5.54896C10.3145 5.78327 9.93544 5.78327 9.70113 5.54896L6.99995 2.84779L4.29878 5.54896C4.06447 5.78327 3.68544 5.78327 3.45113 5.54896C3.21681 5.31464 3.21681 4.93562 3.45113 4.7013L6.57613 1.5763L6.66988 1.49915Z" fill="currentColor" /></svg>
}
