import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Portal the menu so the original scrolling list never clips its actions. */
export function HubMenu({ children, onClose, width = 160 }: { children: ReactNode; onClose: () => void; width?: number }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0, visibility: 'hidden' as 'hidden' | 'visible' })
  useLayoutEffect(() => {
    const trigger = anchor.current?.parentElement?.querySelector<HTMLElement>('[aria-expanded="true"]')
    const surface = menu.current
    if (!trigger || !surface) return
    const rect = trigger.getBoundingClientRect()
    const menuRect = surface.getBoundingClientRect()
    setPosition({ left: Math.max(8, Math.min(window.innerWidth - menuRect.width - 8, rect.right - menuRect.width)), top: rect.bottom + menuRect.height + 12 < window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - menuRect.height - 4), visibility: 'visible' })
    surface.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const closeOnScroll = (event: Event) => { if (!surface.contains(event.target as Node)) onClose() }
    window.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', onClose)
    return () => { window.removeEventListener('scroll', closeOnScroll, true); window.removeEventListener('resize', onClose) }
  }, [onClose])
  return <><span ref={anchor} hidden />{createPortal(<div ref={menu} className="hub-action-menu" role="menu" style={{ ...position, position: 'fixed', right: 'auto', minWidth: width }} onKeyDown={(event) => {
    if (event.key === 'Escape' || event.key === 'Tab') { onClose(); anchor.current?.parentElement?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus(); if (event.key === 'Escape') event.preventDefault() }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
    }
  }}>{children}</div>, document.body)}</>
}
