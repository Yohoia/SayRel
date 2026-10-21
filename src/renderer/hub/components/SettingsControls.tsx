import { useEffect, useRef, useState } from 'react'
import type { ReactNode, KeyboardEvent } from 'react'
import { DEFAULT_SETTINGS, type ShortcutBinding } from '../../../shared/settings'
import { bindingsFor, normalizeTranslationTargets, SHORTCUT_KEYS, validateShortcut, type ShortcutKey } from '../../../shared/settingsControls'
import { api } from '../../shared/utils/bridge'
import { Modal } from '../../shared/components/Modal'
import { toast } from '../../shared/components/Toast'
import { useAppSettings } from '../state/settings'
import { HubSelect } from './HubSelect'
import { interfaceLanguages, useSettingsText } from './settingsText'

export function SettingsDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useSettingsText()
  return <div className="settings-subdialog"><Modal title={t(title)} onClose={onClose}>{children}</Modal></div>
}
export function KeyCaps({ value }: { value: string }) {
  const symbols: Record<string, string> = { Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧', Space: '␣' }
  return <>{value.split('+').map((key, index) => <kbd key={index}>{symbols[key] ?? key}</kbd>)}</>
}

export function ShortcutEditor({ settingKey }: { settingKey: ShortcutKey }) {
  const { settings, patch } = useAppSettings()
  const t = useSettingsText()
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const capture = useRef('')
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
    const off = window.offkey.on('keyboard:shortcut-captured', (event: { combination: string; pressed: boolean }) => {
      if (disposed) return
      if (event.combination === 'Escape') { setEditing(null); return }
      if (event.pressed) { capture.current = event.combination; setDraft(event.combination) }
      else if (event.combination !== 'Escape') finish.current(capture.current)
    })
    void window.offkey.invoke('keyboard:begin-shortcut-capture').catch(() => { toast.error('无法录制快捷键，请重试') })
    const away = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setEditing(null) }
    const blur = () => setEditing(null)
    window.addEventListener('blur', blur)
    document.addEventListener('pointerdown', away)
    return () => { disposed = true; off?.(); document.removeEventListener('pointerdown', away); window.removeEventListener('blur', blur); void window.offkey.invoke('keyboard:end-shortcut-capture') }
  }, [editing])
  function begin(index: number) { capture.current = ''; setDraft(''); setEditing(index) }
  function keyDown(event: KeyboardEvent) {
    if (editing === null) return
    event.preventDefault(); event.stopPropagation()
    if (event.key === 'Escape') { setEditing(null); return }
    const parts: string[] = []
    if (event.getModifierState('Fn')) parts.push('Fn')
    if (event.metaKey) parts.push('Command')
    if (event.ctrlKey) parts.push('Control')
    if (event.altKey) parts.push('Alt')
    if (event.shiftKey) parts.push('Shift')
    const names: Record<string, string> = { ' ': 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' }
    if (!['Meta', 'Control', 'Alt', 'Shift', 'Fn'].includes(event.key)) parts.push(names[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key))
    if (parts.length) { capture.current = parts.join('+'); setDraft(capture.current) }
  }
  return <div className="settings-shortcuts" ref={container}>
    {[...bindings, ...(editing === bindings.length ? [{ accelerator: '', enabled: true, style: 'toggle' as const }] : [])].map((binding, index) => <div className="settings-shortcut-item" key={index}>
      <button className={`settings-shortcut-key ${editing === index ? 'is-recording' : ''}`} aria-label={t('更改快捷键')} onClick={() => begin(index)} onBlur={event => { if (!container.current?.contains(event.relatedTarget as Node)) setEditing(null) }} onKeyDown={keyDown} onKeyUp={event => { if (editing === index) { event.preventDefault(); event.stopPropagation(); finish.current(capture.current) } }}>
        {editing === index ? (draft ? <KeyCaps value={draft} /> : <span>{t('按下键盘按键或鼠标按钮')}</span>) : <KeyCaps value={binding.accelerator} />}
      </button>
      {editing === index && index === 0 ? <button className="settings-shortcut-action" aria-label={t('重置快捷键')} title={t('重置快捷键')} onClick={() => finish.current(DEFAULT_SETTINGS[settingKey].accelerator)}>↺</button> : editing !== index && (settingKey !== 'shortcut' || bindings.length > 1) && <button className="settings-shortcut-action" aria-label={t('禁用快捷键')} title={t('禁用快捷键')} onClick={() => void save(bindings.filter((_, i) => i !== index))}>×</button>}
    </div>)}
    {editing === null && bindings.length < 4 && <button className="settings-add" onClick={event => { begin(bindings.length); requestAnimationFrame(() => container.current?.querySelector<HTMLButtonElement>('.is-recording')?.focus()) }}>{t(bindings.length ? '添加另一个' : '添加快捷方式')}</button>}
  </div>
}

const VARIANTS = [
  { name: '英语', codes: ['en-US', 'en-GB', 'en-AU', 'en-CA'] },
  { name: '中文', codes: ['zh-CN', 'zh-HK', 'zh-TW'] },
  { name: '西班牙语', codes: ['es-MX', 'es-ES', 'es-US'] },
  { name: '法语', codes: ['fr-FR', 'fr-CA'] },
  { name: '葡萄牙语', codes: ['pt-PT', 'pt-BR'] }
]
export function LanguageVariants() {
  const { settings, patch } = useAppSettings()
  const t = useSettingsText()
  const [open, setOpen] = useState(false)
  const names = new Intl.DisplayNames([settings.language ?? 'zh-CN'], { type: 'language' })
  return <><button className="settings-pill" onClick={() => setOpen(true)}>{t('选择语言变体')}</button>{open && <SettingsDialog title="语言变体" onClose={() => setOpen(false)}>
    <p>{t('选择您在听写中使用的每种语言的首选变体（例如，美国英语或英国英语），以确保使用 Offkey 时获得最佳体验。')}</p>
    <div className="settings-variants">{VARIANTS.map(group => <div className="settings-variant" key={group.name}><span>{t(group.name)}</span><HubSelect label={t(group.name)} value={settings.preferredLanguages.find(code => group.codes.includes(code)) ?? group.codes[0]} options={group.codes.map(value => ({ value, label: names.of(value) ?? value }))} onChange={value => void patch({ preferredLanguages: [...settings.preferredLanguages.filter(code => !group.codes.includes(code) && code !== group.codes[0].split('-')[0]), value] })} /></div>)}</div>
    <span className="settings-other-languages" title={t('仅提供英语、中文、西班牙语、法语和葡萄牙语变体。所有其他语言使用标准变体。')}>{t('其他语言怎么办？')}</span>
  </SettingsDialog>}</>
}

export function TranslationTargets() {
  const { settings, patch } = useAppSettings()
  const t = useSettingsText()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const drag = useRef<number | null>(null)
  const targets = settings.translationTargetLanguages
  const names = new Intl.DisplayNames([settings.language ?? 'zh-CN'], { type: 'language' })
  const label = (code: string) => names.of(code) ?? code
  const save = (values: string[]) => patch(normalizeTranslationTargets(values, values[0]))
  const options = [...new Set([...interfaceLanguages.map(option => option.value), ...VARIANTS.flatMap(group => group.codes)])].filter(code => !targets.includes(code) && label(code).toLowerCase().includes(search.toLowerCase()))
  function reorder(from: number, to: number) { const next = [...targets]; next.splice(to, 0, next.splice(from, 1)[0]); void save(next) }
  return <><button className="settings-picker" title={targets.map(label).join(', ')} onClick={() => setOpen(true)}><span>{targets.map(label).join(', ')}</span><span aria-hidden>✎</span></button>{open && <SettingsDialog title="翻译目标" onClose={() => { setOpen(false); setAdding(false) }}>
    <p>{t('在翻译模式中最多选择3种目标语言进行听写。')}</p>
    <div className="settings-translation-preview" aria-hidden="true"><div className="settings-preview-bar">× <span>▂▅▃▇▂▅▃</span> ✓</div><div className="settings-preview-languages">{targets.map(code => <span key={code}>{label(code)}</span>)}</div></div>
    <div className="settings-language-list">{targets.map((code, index) => <div className="settings-language-item" draggable key={code} onDragStart={() => { drag.current = index }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (drag.current !== null) reorder(drag.current, index); drag.current = null }}><button className="settings-drag" aria-label={`移动 ${label(code)}`} title="拖动以排序；方向键调整顺序" onKeyDown={event => { const next = index + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0); if (next !== index && next >= 0 && next < targets.length) { event.preventDefault(); reorder(index, next) } }}>⠿</button><span>{label(code)}</span>{targets.length > 1 && <button aria-label={`移除 ${label(code)}`} onClick={() => void save(targets.filter(value => value !== code))}>×</button>}</div>)}</div>
    <button className="settings-add" disabled={targets.length >= 3} title={targets.length >= 3 ? t('最多支持 3 种目标语言。删除一个以添加另一个。') : undefined} onClick={() => setAdding(!adding)}>{t('添加另一种语言')}</button>
    {adding && <div className="settings-language-search"><input autoFocus aria-label={t('添加语言')} placeholder={t('搜索')} value={search} onChange={event => setSearch(event.target.value)} /><div role="listbox" aria-label={t('添加语言')}>{options.map(code => <button role="option" aria-selected={false} key={code} onClick={async () => { await save([...targets, code]); setAdding(false); setSearch('') }}>{label(code)}</button>)}</div></div>}
  </SettingsDialog>}</>
}

export function MicrophonePicker({ autoOpen = false }: { autoOpen?: boolean }) {
  const { settings, patch } = useAppSettings()
  const t = useSettingsText()
  const [open, setOpen] = useState(autoOpen)
  const [nativeDevices, setNativeDevices] = useState<{ label: string; transport?: string; isDefault: boolean }[]>([])
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selected, setSelected] = useState(settings.micDevice ?? '')
  const [level, setLevel] = useState(0)
  const [saving, setSaving] = useState(false)
  useEffect(() => { void api.audio.getDevices().then((list: any) => { if (Array.isArray(list)) setNativeDevices(list) }).catch(() => undefined) }, [])
  useEffect(() => { void navigator.mediaDevices?.enumerateDevices().then(list => setDevices(list.filter(device => device.kind === 'audioinput' && device.deviceId !== 'default'))).catch(() => undefined) }, [])
  useEffect(() => {
    if (!open) return
    let disposed = false, frame = 0
    let stream: MediaStream | undefined, context: AudioContext | undefined
    setLevel(0)
    const refresh = () => { void navigator.mediaDevices.enumerateDevices().then(list => { if (!disposed) setDevices(list.filter(device => device.kind === 'audioinput' && device.deviceId !== 'default')) }).catch(() => undefined) }
    void (async () => {
      try {
        const state = await api.recording.state()
        if (disposed) return
        if (state?.phase && !['idle', 'error'].includes(state.phase)) { toast.info('请先结束当前录音'); return }
        stream = await navigator.mediaDevices.getUserMedia({ audio: selected ? { deviceId: { exact: selected } } : true, video: false })
        if (disposed) { stream.getTracks().forEach(track => track.stop()); return }
        refresh()
        context = new AudioContext()
        const analyser = context.createAnalyser(); analyser.fftSize = 256
        context.createMediaStreamSource(stream).connect(analyser)
        await context.resume()
        if (disposed) return
        const samples = new Uint8Array(analyser.fftSize)
        const tick = () => { analyser.getByteTimeDomainData(samples); setLevel(Math.min(1, Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length) * 5)); frame = requestAnimationFrame(tick) }
        tick()
      } catch (failure) { if (!disposed) { const message = failure instanceof Error ? failure.message : '无法访问麦克风'; toast.error(message) } }
    })()
    navigator.mediaDevices?.addEventListener('devicechange', refresh)
    return () => { disposed = true; cancelAnimationFrame(frame); stream?.getTracks().forEach(track => track.stop()); void context?.close().catch(() => undefined); navigator.mediaDevices?.removeEventListener('devicechange', refresh) }
  }, [open, selected])
  const defaultName = nativeDevices.find(device => device.isDefault)?.label
  const autoLabel = t('自动检测') + (defaultName ? ` (${defaultName})` : '')
  const description = (device: MediaDeviceInfo) => {
    const native = nativeDevices.find(item => item.label === device.label)
    if (native?.transport === 'builtin') return t('推荐')
    if (native?.transport === 'bluetooth') return t('蓝牙麦克风')
    if (native?.transport) return t('外部麦克风')
    return ''
  }
  const selectDevice = async (value: string) => {
    setSaving(true)
    try { await patch({ micDevice: value || null }); setSelected(value) }
    catch { return }
    finally { setSaving(false) }
  }
  const meter = <span className="settings-mic-level" role="meter" aria-label="麦克风音量" aria-valuenow={Math.round(level * 100)} aria-valuemin={0} aria-valuemax={100}>{Array.from({ length: 6 }, (_, i) => <i key={i} style={{ height: `${Math.max(4, Math.min(22, level * 22 * (i % 2 ? 1 : 0.65)))}px` }} className={level > 0.02 ? 'is-active' : ''} />)}</span>
  return <><button className="settings-picker" onClick={() => { setSelected(settings.micDevice ?? ''); setOpen(true) }}><span>{settings.micDevice ? devices.find(device => device.deviceId === settings.micDevice)?.label || t('未知设备') : autoLabel}</span><span aria-hidden>⌄</span></button>{open && <SettingsDialog title="麦克风" onClose={() => setOpen(false)}>
    <p>{t('选择能捕捉到您声音的麦克风。如果指示条没有移动，请尝试其他麦克风。')}</p>
    <div className="settings-mic-list" role="radiogroup" aria-label={t('麦克风')}><button role="radio" aria-checked={!selected} disabled={saving} className="settings-mic-option" onClick={() => void selectDevice('')}><span>{autoLabel}<small>{t('使用系统默认麦克风')}</small></span>{!selected && meter}</button>{devices.map(device => <button role="radio" aria-checked={selected === device.deviceId} disabled={saving} className="settings-mic-option" key={device.deviceId} onClick={() => void selectDevice(device.deviceId)}><span>{device.label || t('未知设备')}{description(device) && <small>{description(device)}</small>}</span>{selected === device.deviceId && meter}</button>)}</div>
    {!devices.length && <p>{t('未检测到麦克风')}<br />{t('检查您的设备设置或连接麦克风。')}</p>}
  </SettingsDialog>}</>
}

export function FeatureTour({ onClose }: { onClose: () => void }) {
  const t = useSettingsText()
  const { settings } = useAppSettings()
  const [step, setStep] = useState(0)
  const steps = [
    { title: '语音输入', shortcut: settings.shortcut.accelerator, description: '按下开始和停止语音输入。', example: '明天下午三点，我们一起讨论项目进度。' },
    { title: '翻译', shortcut: settings.translationShortcut.accelerator, description: '按下开始和停止翻译。', example: '选择目标语言，自然地说出您想表达的内容。' },
    { title: '随便问', shortcut: settings.askAnythingShortcut.accelerator, description: '按下开始和停止随便提问。', example: '请帮我把这段话写得更简洁。' }
  ]
  return <SettingsDialog title="探索关键功能" onClose={onClose}><div className="settings-tour"><span>{step + 1} / 3</span><h3>{t(steps[step].title)}</h3><div className="settings-tour-keys"><KeyCaps value={steps[step].shortcut} /></div><p>{t(steps[step].description)}</p><blockquote>{steps[step].example}</blockquote></div><div className="settings-dialog-actions"><button className="settings-pill" onClick={onClose}>{t('退出')}</button><button className="settings-pill is-primary" onClick={() => step === 2 ? onClose() : setStep(step + 1)}>{t(step === 2 ? '完成' : '下一步')}</button></div></SettingsDialog>
}
