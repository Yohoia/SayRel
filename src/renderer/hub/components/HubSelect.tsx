import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Option = { value: string; label: string; disabled?: boolean }

/** Typeless O6 select: 40px control, 10px corners, 8px menu items. */
export function HubSelect({ value, options, onChange, label, disabled = false, compact = false }: {
  value: string; options: Option[]; onChange: (value: string) => void; label: string; disabled?: boolean; compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 198, maxHeight: 300 })
  const control = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()
  useLayoutEffect(() => {
    if (!open || !control.current) return
    const rect = control.current.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 12
    const height = Math.min(options.length * 36 + 10, 300)
    const above = below < height && rect.top > below
    setPosition({ left: Math.min(rect.left, window.innerWidth - rect.width - 8), top: above ? Math.max(8, rect.top - height - 4) : rect.bottom + 4, width: rect.width, maxHeight: Math.min(300, above ? rect.top - 12 : below) })
    requestAnimationFrame(() => (menu.current?.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus())
  }, [open, options.length])
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (event.type === 'resize' || (!control.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node))) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true) }
  }, [open])
  return <><button ref={control} type="button" className={`hub-select ${compact ? 'is-compact' : ''}`} aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) } }}><span>{options.find((option) => option.value === value)?.label ?? value}</span><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m7 10 5 5 5-5z" /></svg></button>{open && createPortal(<div ref={menu} id={id} role="listbox" aria-label={label} className="hub-select-menu" style={position} onKeyDown={(event) => {
    if (event.key === 'Escape' || event.key === 'Tab') { setOpen(false); control.current?.focus(); if (event.key === 'Escape') event.preventDefault() }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
    }
  }}>{options.map((option) => <button type="button" key={option.value} role="option" aria-selected={value === option.value} disabled={option.disabled} onClick={() => { onChange(option.value); setOpen(false); control.current?.focus() }}>{option.label}</button>)}</div>, document.body)}</>
}
