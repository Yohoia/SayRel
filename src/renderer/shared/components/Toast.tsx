import { useAppText } from '../i18n/useAppText'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icons'
import '../styles/feedback.css'

type ToastInput = { message: string } & (
  { tone: 'loading' } | { tone: 'success' | 'error' | 'info'; duration?: number }
)
type ToastEntry = { id: number; input: ToastInput; leaving: boolean }
let entries: ToastEntry[] = []
let nextId = 0
const listeners = new Set<() => void>()
const removals = new Map<number, ReturnType<typeof setTimeout>>()
const emit = () => listeners.forEach(listener => listener())
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

function dismiss(id: number) {
  if (!entries.some(entry => entry.id === id && !entry.leaving)) return
  entries = entries.map(entry => entry.id === id ? { ...entry, leaving: true } : entry)
  emit()
  removals.set(id, setTimeout(() => {
    entries = entries.filter(entry => entry.id !== id); removals.delete(id); emit()
  }, 180))
}

function show(input: ToastInput): number {
  const duplicate = entries.find(entry => !entry.leaving && entry.input.tone === input.tone && entry.input.message === input.message)
  if (duplicate) { update(duplicate.id, input); return duplicate.id }
  const id = ++nextId
  entries = [...entries, { id, input, leaving: false }]
  const visible = entries.filter(entry => !entry.leaving)
  if (visible.length > 3) dismiss(visible[0].id)
  emit()
  return id
}

function update(id: number, input: ToastInput) {
  clearTimeout(removals.get(id)); removals.delete(id)
  entries = entries.map(entry => entry.id === id ? { id, input, leaving: false } : entry)
  emit()
}

export const toast = {
  show, update, dismiss,
  success: (message: string) => show({ tone: 'success', message }),
  error: (message: string) => show({ tone: 'error', message }),
  info: (message: string) => show({ tone: 'info', message }),
  loading: (message: string) => show({ tone: 'loading', message })
}

function ToastCard({ entry }: { entry: ToastEntry }) {
  const t = useAppText()
  const { id, input, leaving } = entry
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [windowPaused, setWindowPaused] = useState(false)
  const remaining = useRef(0)
  useEffect(() => {
    const pause = () => setWindowPaused(true), resume = () => setWindowPaused(false)
    window.addEventListener('blur', pause); window.addEventListener('focus', resume)
    return () => { window.removeEventListener('blur', pause); window.removeEventListener('focus', resume) }
  }, [])
  useEffect(() => { remaining.current = input.tone === 'loading' ? 0 : input.duration ?? (input.tone === 'error' ? 6500 : 3600) }, [input])
  useEffect(() => {
    if (input.tone === 'loading' || hovered || focused || windowPaused || leaving) return
    const started = performance.now()
    const timer = setTimeout(() => dismiss(id), remaining.current)
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (performance.now() - started)) }
  }, [id, input, hovered, focused, windowPaused, leaving])
  return <div className={`sayrel-toast is-${input.tone}${leaving ? ' is-leaving' : ''}`} data-toast-id={id}
    tabIndex={0} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(id) } }}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    {input.tone === 'success' && <Icon name="check" size={16} className="toast-check" />}
    {input.tone === 'loading' && <span className="feedback-spinner" aria-hidden="true" />}
    <span className="toast-message" role={input.tone === 'error' ? 'alert' : 'status'} aria-atomic="true" title={t(input.message)}>{t(input.message)}</span>
  </div>
}

export function ToastViewport() {
  const t = useAppText()
  const snapshot = useSyncExternalStore(subscribe, () => entries)
  return createPortal(<section className="toast-viewport" aria-label={t("Notifications")}>{snapshot.map(entry => <ToastCard entry={entry} key={entry.id} />)}</section>, document.body)
}
