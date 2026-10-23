import { useEffect, useRef, useState } from 'react'
import type { ReactNode, KeyboardEvent } from 'react'
import { DEFAULT_SETTINGS, type ShortcutBinding } from '../../../shared/settings'
import { bindingsFor, shortcutLabels, normalizeTranslationTargets, SHORTCUT_KEYS, validateShortcut, type ShortcutKey } from '../../../shared/settingsControls'
import { api } from '../../shared/utils/bridge'
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
  const captureMode = useRef<'pending' | 'native' | 'browser'>('pending')
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
    if (current.editing === null || !accelerator) return
    const used = SHORTCUT_KEYS.flatMap(key => bindingsFor(current.settings, key).filter((_, i) => key !== settingKey || i !== current.editing).map(binding => binding.accelerator))
    if (current.settings.commandShortcut.enabled) used.push(current.settings.commandShortcut.accelerator)
    const problem = validateShortcut(accelerator, used)
    if (problem) { toast.error(t(problem)); return }
    const next = [...current.bindings]
    next[current.editing] = { accelerator, enabled: true, style: 'toggle' }
    void save(next).then(() => { setEditing(null) }).catch(() => undefined)
  }
  useEffect(() => {
    if (editing === null) return
    let disposed = false
    captureMode.current = 'pending'
    const off = window.sayrel.on('keyboard:shortcut-captured', (event: { combination: string; pressed: boolean }) => {
      if (disposed) return
      if (event.combination === 'Escape') { setEditing(null); return }
      if (event.pressed) { capture.current = event.combination; setDraft(event.combination) }
      else if (event.combination !== 'Escape') finish.current(capture.current)
    })
    void window.sayrel.invoke('keyboard:begin-shortcut-capture').then((result: { native: boolean }) => { if (!disposed) captureMode.current = result.native ? 'native' : 'browser' }).catch(() => { if (!disposed) { setEditing(null); toast.error("Could not record the shortcut. Please try again.") } })
    const away = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setEditing(null) }
    const blur = () => setEditing(null)
    window.addEventListener('blur', blur)
    document.addEventListener('pointerdown', away)
    return () => { disposed = true; off?.(); document.removeEventListener('pointerdown', away); window.removeEventListener('blur', blur); void window.sayrel.invoke('keyboard:end-shortcut-capture') }
  }, [editing])
  function begin(index: number) { capture.current = ''; setDraft(''); setEditing(index) }
  function keyDown(event: KeyboardEvent) {
    if (editing === null) return
    event.preventDefault(); event.stopPropagation()
    if (event.key === 'Escape') { setEditing(null); return }
    if (captureMode.current !== 'browser') return
    const parts: string[] = []
    if (event.getModifierState('Fn')) parts.push('Fn')
    if (event.metaKey) parts.push('Command')
    if (event.ctrlKey) parts.push('Control')
    if (event.altKey) parts.push('Alt')
    if (event.shiftKey) parts.push(event.code === 'ShiftRight' ? 'RightShift' : 'LeftShift')
    const names: Record<string, string> = { ' ': 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' }
    if (!['Meta', 'Control', 'Alt', 'Shift', 'Fn', 'Unidentified'].includes(event.key)) parts.push(names[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key))
    if (parts.length) { capture.current = parts.join('+'); setDraft(capture.current) }
  }
  return <div className="settings-shortcuts" ref={container}>
    {[...bindings, ...(editing === bindings.length ? [{ accelerator: '', enabled: true, style: 'toggle' as const }] : [])].map((binding, index) => <div className="settings-shortcut-item" key={index}>
      <button className={`settings-shortcut-key ${editing === index ? 'is-recording' : ''}`} aria-label={t("Change shortcut")} onClick={() => begin(index)} onBlur={event => { if (!container.current?.contains(event.relatedTarget as Node)) setEditing(null) }} onKeyDown={keyDown} onKeyUp={event => { if (editing === index) { event.preventDefault(); event.stopPropagation(); if (captureMode.current === 'browser') finish.current(capture.current) } }}>
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
