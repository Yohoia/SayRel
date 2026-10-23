import { useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, offset, useFloating, useFocus, useHover, useInteractions } from '@floating-ui/react'
import { Icon } from '../shared/components/Icons'

export function FloatingAction({ icon, label, tooltip, shortcut, collapsed, disabled, style, onClick }: {
  icon: 'close' | 'check'
  label: string
  tooltip: string
  shortcut?: string
  collapsed: boolean
  disabled: boolean
  style: CSSProperties
  onClick: () => void
}) {
  const [open, setOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({ open, onOpenChange:setOpen, placement:'top', strategy:'fixed', middleware:[offset(14)], whileElementsMounted:autoUpdate })
  const hover = useHover(context, { enabled:!collapsed && !disabled, delay:{ open:100, close:0 } })
  const focus = useFocus(context, { enabled:!collapsed && !disabled })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus])
  return <>
    <button ref={refs.setReference} type="button" {...getReferenceProps()} className={`floating-action ${collapsed ? 'is-collapsed' : ''}`} style={style} disabled={disabled} tabIndex={collapsed ? -1 : 0} aria-label={label} onClick={onClick}><Icon name={icon} size={16} /></button>
    {open && !collapsed && !disabled && createPortal(<div ref={refs.setFloating} {...getFloatingProps()} className="floating-tooltip floating-action-tooltip" role="tooltip" style={floatingStyles}>{tooltip}{shortcut && <kbd>{shortcut}</kbd>}</div>, document.body)}
  </>
}
