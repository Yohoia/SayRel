import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DEFAULT_SETTINGS, type ShortcutBinding } from '../../../shared/settings'
import { bindingsFor, shortcutLabels, normalizeTranslationTargets, SHORTCUT_KEYS, validateShortcut, type ShortcutKey } from '../../../shared/settingsControls'
import { startShortcutCapture } from '../../shared/shortcutCapture'
import { Modal } from '../../shared/components/Modal'
import { toast } from '../../shared/components/Toast'
import { useAppSettings } from '../../shared/state/settings'
import { HubSelect } from './HubSelect'
import { interfaceLanguages, useSettingsText } from './settingsText'

export function SettingsDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useSettingsText()
  return <div className="settings-subdialog"><Modal title={t(title)} onClose={onClose}>{children}</Modal></div>
}
export function KeyCaps({ value }: { value: string }) {
  return <>{shortcutLabels(value).map((key, index) => <kbd key={index}>{key}</kbd>)}</>
}

export function ShortcutEditor({ settingKey }: { settingKey: ShortcutKey }) {
  const { settings, patch } = useAppSettings()
  const t = useSettingsText()
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const capture = useRef('')
  const editGeneration = useRef(0)
  const savingGeneration = useRef<number | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const bindings = bindingsFor(settings, settingKey)
  const latest = useRef({ settings, bindings, editing })
  latest.current = { settings, bindings, editing }
  async function save(next: ShortcutBinding[]) {
    await patch({ [settingKey]: next[0] ?? { ...settings[settingKey], enabled: false }, additionalShortcuts: { ...settings.additionalShortcuts, [settingKey]: next.slice(1) } })
  }
  const finish = useRef((accelerator: string) => {})
  finish.current = accelerator => {
    const current = latest.current
    const generation = editGeneration.current
    if (current.editing === null || !accelerator || savingGeneration.current === generation) return
    const used = SHORTCUT_KEYS.flatMap(key => bindingsFor(current.settings, key).filter((_, i) => key !== settingKey || i !== current.editing).map(binding => binding.accelerator))
    if (current.settings.commandShortcut.enabled) used.push(current.settings.commandShortcut.accelerator)
    const problem = validateShortcut(accelerator, used)
    if (problem) { toast.error(t(problem)); return }
    const next = [...current.bindings]
    next[current.editing] = { accelerator, enabled: true, style: 'toggle' }
    savingGeneration.current = generation
    void save(next).then(() => {
      if (editGeneration.current === generation) setEditing(null)
    }).catch(() => undefined).finally(() => {
      if (savingGeneration.current === generation) savingGeneration.current = null
    })
  }
  useEffect(() => {
    if (editing === null) return
    let disposed = false
    const session = startShortcutCapture({ bridge: window.sayrel, onEvent: event => {
      if (disposed) return
      if (event.type === 'cancel') { cancel(); return }
      if (savingGeneration.current === editGeneration.current) return
      if (event.pressed) { capture.current = event.combination; setDraft(event.combination) }
      else if (event.combination !== 'Escape') finish.current(capture.current)
    } })
    const cancel = () => { disposed = true; void session.stop(); setEditing(null) }
    void session.ready.catch(() => { if (!disposed) { setEditing(null); toast.error("Could not record the shortcut. Please try again.") } })
    const away = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) cancel() }
    const blur = cancel
    const element = container.current
    const focusout = (event: FocusEvent) => { if (!(event.relatedTarget instanceof Node) || !element?.contains(event.relatedTarget)) cancel() }
    element?.addEventListener('focusout', focusout)
    window.addEventListener('blur', blur)
    document.addEventListener('pointerdown', away)
    return () => { disposed = true; element?.removeEventListener('focusout', focusout); document.removeEventListener('pointerdown', away); window.removeEventListener('blur', blur); void session.stop() }
  }, [editing])
  function begin(index: number) { editGeneration.current++; capture.current = ''; setDraft(''); setEditing(index) }
  return <div className="settings-shortcuts" ref={container}>
    {[...bindings, ...(editing === bindings.length ? [{ accelerator: '', enabled: true, style: 'toggle' as const }] : [])].map((binding, index) => <div className="settings-shortcut-item" key={index}>
      <button className={`settings-shortcut-key ${editing === index ? 'is-recording' : ''}`} aria-label={t("Change shortcut")} onClick={() => begin(index)}>
        {editing === index ? (draft ? <KeyCaps value={draft} /> : <span>{t("Press key or mouse button")}</span>) : <KeyCaps value={binding.accelerator} />}
      </button>
      {editing === index && index === 0 ? <button className="settings-shortcut-action" aria-label={t("Reset shortcut")} title={t("Reset shortcut")} onClick={() => finish.current(DEFAULT_SETTINGS[settingKey].accelerator)}>↺</button> : editing !== index && (settingKey !== 'shortcut' || bindings.length > 1) && <button className="settings-shortcut-action" aria-label={t("Disable shortcut")} title={t("Disable shortcut")} onClick={() => { void save(bindings.filter((_, i) => i !== index)).catch(() => undefined) }}>×</button>}
    </div>)}
    {editing === null && bindings.length < 4 && <button className="settings-add" onClick={event => { begin(bindings.length); requestAnimationFrame(() => container.current?.querySelector<HTMLButtonElement>('.is-recording')?.focus()) }}>{t(bindings.length ? "Add another" : "Add shortcut")}</button>}
  </div>
}

const VARIANTS = [
  { name: "English", codes: ['en-US', 'en-GB', 'en-AU', 'en-CA'] },
  { name: "Chinese", codes: ['zh-CN', 'zh-HK', 'zh-TW'] },
  { name: "Spanish", codes: ['es-MX', 'es-ES', 'es-US'] },
  { name: "French", codes: ['fr-FR', 'fr-CA'] },
  { name: "Portuguese", codes: ['pt-PT', 'pt-BR'] }
]
export function LanguageVariants() {
  const { settings, patch } = useAppSettings()
  const t = useSettingsText()
  const [open, setOpen] = useState(false)
  const names = new Intl.DisplayNames([settings.language ?? 'en'], { type: 'language' })
  return <><button className="settings-pill" onClick={() => setOpen(true)}>{t("Select language variants")}</button>{open && <SettingsDialog title="Language variants" onClose={() => setOpen(false)}>
    <p>{t("Choose your preferred variant for each language you use in dictation (e.g., US English or UK English) to ensure the best experience with Sayrel.")}</p>
    <div className="settings-variants">{VARIANTS.map(group => <div className="settings-variant" key={group.name}><span>{t(group.name)}</span><HubSelect label={t(group.name)} value={settings.preferredLanguages.find(code => group.codes.includes(code)) ?? group.codes[0]} options={group.codes.map(value => ({ value, label: names.of(value) ?? value }))} onChange={value => { void patch({ preferredLanguages: [...settings.preferredLanguages.filter(code => !group.codes.includes(code) && code !== group.codes[0].split('-')[0]), value] }).catch(() => undefined) }} /></div>)}</div>
    <span className="settings-other-languages" title={t("Only English, Chinese, Spanish, French, and Portuguese variants are available. All other languages use standard variants.")}>{t("What about other languages?")}</span>
  </SettingsDialog>}</>
}

export function TranslationTargets({ autoOpen = false }: { autoOpen?: boolean }) {
  const { settings, patch } = useAppSettings()
  const t = useSettingsText()
  const [open, setOpen] = useState(autoOpen)
  useEffect(() => { if (autoOpen) setOpen(true) }, [autoOpen])
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const drag = useRef<number | null>(null)
  const targets = settings.translationTargetLanguages
  const names = new Intl.DisplayNames([settings.language ?? 'en'], { type: 'language' })
  const label = (code: string) => names.of(code) ?? code
  const save = (values: string[]) => patch(normalizeTranslationTargets(values, values[0]))
  const options = [...new Set([...interfaceLanguages.map(option => option.value), ...VARIANTS.flatMap(group => group.codes)])].filter(code => !targets.includes(code) && label(code).toLowerCase().includes(search.toLowerCase()))
  function reorder(from: number, to: number) { const next = [...targets]; next.splice(to, 0, next.splice(from, 1)[0]); void save(next).catch(() => undefined) }
  return <><button className="settings-picker" title={targets.map(label).join(', ')} onClick={() => setOpen(true)}><span>{targets.map(label).join(', ')}</span><span aria-hidden>✎</span></button>{open && <SettingsDialog title="Translation targets" onClose={() => { setOpen(false); setAdding(false) }}>
    <p>{t("Choose up to 3 target languages for your dictation in translation mode.")}</p>
    <div className="settings-translation-preview" aria-hidden="true"><div className="settings-preview-bar">× <span>▂▅▃▇▂▅▃</span> ✓</div><div className="settings-preview-languages">{targets.map(code => <span key={code}>{label(code)}</span>)}</div></div>
    <div className="settings-language-list">{targets.map((code, index) => <div className="settings-language-item" draggable key={code} onDragStart={() => { drag.current = index }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (drag.current !== null) reorder(drag.current, index); drag.current = null }}><button className="settings-drag" aria-label={`Move ${label(code)}`} title="Drag to reorder; use arrow keys to adjust" onKeyDown={event => { const next = index + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0); if (next !== index && next >= 0 && next < targets.length) { event.preventDefault(); reorder(index, next) } }}>⠿</button><span>{label(code)}</span>{targets.length > 1 && <button aria-label={`Remove ${label(code)}`} onClick={() => { void save(targets.filter(value => value !== code)).catch(() => undefined) }}>×</button>}</div>)}</div>
    <button className="settings-add" disabled={targets.length >= 3} title={targets.length >= 3 ? t("Maximum 3 target languages. Remove one to add another.") : undefined} onClick={() => setAdding(!adding)}>{t("Add another language")}</button>
    {adding && <div className="settings-language-search"><input autoFocus aria-label={t("Add language")} placeholder={t("Search")} value={search} onChange={event => setSearch(event.target.value)} /><div role="listbox" aria-label={t("Add language")}>{options.map(code => <button role="option" aria-selected={false} key={code} onClick={() => { void save([...targets, code]).then(() => { setAdding(false); setSearch('') }).catch(() => undefined) }}>{label(code)}</button>)}</div></div>}
  </SettingsDialog>}</>
}
