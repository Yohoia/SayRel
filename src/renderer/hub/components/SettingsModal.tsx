import { useEffect, useRef } from 'react'
import { useSettingsText } from './settingsText'
import { SettingsPanel } from './SettingsPanel'

export function SettingsModalHost({ open, section, onClose }: { open: boolean; section: string; onClose: () => void }) {
  const t = useSettingsText()
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('.settings-subdialog [role="dialog"],[role="alertdialog"]')) return
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'Tab') {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]')
        if (!controls?.length) return
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); previousFocus?.focus() }
  }, [open, onClose])
  if (!open) return null
  return <div className="settings-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="settings-modal" role="dialog" aria-modal="true" aria-label={t("Settings")} tabIndex={-1} ref={dialogRef}>
      <SettingsPanel section={section} />
      <button type="button" className="settings-modal-close" onClick={onClose} aria-label={t("Close settings")}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M18.3 5.71a.996.996 0 0 0-1.41 0L12 10.59 7.11 5.7A.996.996 0 1 0 5.7 7.11L10.59 12l-4.89 4.89a.996.996 0 1 0 1.41 1.41L12 13.41l4.89 4.89a.996.996 0 1 0 1.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4" /></svg>
      </button>
    </div>
  </div>
}
