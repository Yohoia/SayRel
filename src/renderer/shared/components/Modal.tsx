import { useAppText } from '../i18n/useAppText'
import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icons'

const stack: symbol[] = []

export function Modal({ title, onClose, children, role = 'dialog', descriptionId, dismissible = true, showClose = true }: {
  title: string; onClose: () => void; children: ReactNode; role?: 'dialog' | 'alertdialog'; descriptionId?: string; dismissible?: boolean; showClose?: boolean
}) {
  const t = useAppText()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const dismissibleRef = useRef(dismissible)
  const identity = useRef(Symbol('modal'))
  const titleId = useId()
  closeRef.current = onClose
  dismissibleRef.current = dismissible
  useEffect(() => {
    const previous = document.activeElement
    const id = identity.current
    stack.push(id)
    const controls = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]') ?? []).filter(node => node.getClientRects().length)
    ;(ref.current?.querySelector<HTMLElement>('[data-dialog-autofocus],input') ?? ref.current)?.focus()
    const key = (event: KeyboardEvent) => {
      if (stack.at(-1) !== id || event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="listbox"]'))) return
      if (event.key === 'Escape') { event.preventDefault(); if (dismissibleRef.current) closeRef.current() }
      if (event.key === 'Tab') {
        const elements = controls(), first = elements[0], last = elements.at(-1)
        if (!first) { event.preventDefault(); ref.current?.focus() }
        else if (!ref.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', key)
    return () => { stack.splice(stack.indexOf(id), 1); window.removeEventListener('keydown', key); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <div className="modal-backdrop" onMouseDown={(event) => { if (dismissible && event.target === event.currentTarget) onClose() }}><div className="modal-card" role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} ref={ref} tabIndex={-1}><h2 id={titleId}>{title}</h2>{showClose && <button type="button" className="icon-button modal-close" aria-label={t("Close dialog")} disabled={!dismissible} onClick={onClose}><Icon name="close" /></button>}{children}</div></div>
}
