import { useEffect, useState } from 'react'
import type { PermissionKind } from '../../../shared/types'
import { api } from '../../shared/utils/bridge'
import { toast } from '../../shared/components/Toast'
import { useSettingsText } from './settingsText'

const PERMISSIONS = [
  { kind: 'microphone', title: 'Microphone', hint: 'Required for voice input. The microphone is only used while recording.' },
  { kind: 'accessibility', title: 'Accessibility', hint: 'Required for global shortcuts and inserting text into other apps.' },
  { kind: 'screenRecording', title: 'Screen recording', hint: 'Optional. Helps identify the active window for context.' }
] satisfies { kind: PermissionKind; title: string; hint: string }[]

type Status = 'checking' | 'granted' | 'denied' | 'error'
const STATUS_TEXT = {
  checking: 'Checking permissions…', granted: 'Enabled', denied: 'Not enabled', error: 'Could not check'
} satisfies Record<Status, string>

export function SettingsPermissions() {
  const t = useSettingsText()
  return <div className="settings-permissions">
    <p className="settings-row-hint settings-permissions-note">{t('Permissions are managed by macOS. Status updates automatically when you return.')}</p>
    {PERMISSIONS.map(permission => <PermissionRow key={permission.kind} {...permission} />)}
  </div>
}

function PermissionRow({ kind, title, hint }: (typeof PERMISSIONS)[number]) {
  const t = useSettingsText()
  const [status, setStatus] = useState<Status>('checking')
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    let disposed = false
    const refresh = async () => {
      try {
        const granted = await api.permission.check(kind)
        if (!disposed) setStatus(granted ? 'granted' : 'denied')
      } catch {
        if (!disposed) setStatus('error')
      }
    }
    void refresh()
    const onFocus = () => { void refresh() }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 2000)
    window.addEventListener('focus', onFocus)
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('focus', onFocus) }
  }, [kind])

  const open = async () => {
    setOpening(true)
    try {
      if (status === 'granted') {
        if (!await api.permission.openSystemPreferences(kind)) throw new Error('System Settings unavailable')
      } else {
        const granted = await api.permission.request(kind)
        setStatus(granted ? 'granted' : 'denied')
        if (!granted) toast.info('Complete authorization in System Settings, then return here.')
      }
    } catch {
      toast.error('Could not open permission settings. Please try again.')
    } finally { setOpening(false) }
  }

  const action = status === 'granted' ? 'Manage' : 'Enable'
  return <div className="settings-row settings-permission-row" data-permission={kind}>
    <div className="settings-row-copy">
      <p className="settings-row-label">{t(title)}{kind === 'screenRecording' && <span className="settings-permission-optional">{t('Optional')}</span>}</p>
      <p className="settings-row-hint">{t(hint)}</p>
    </div>
    <div className="settings-row-control settings-permission-actions">
      <span className={`settings-permission-status is-${status}`} role="status">{t(STATUS_TEXT[status])}</span>
      <button type="button" className={`settings-pill ${status === 'denied' ? 'is-primary' : ''}`}
        aria-label={`${t(action)}: ${t(title)}`} disabled={opening || status === 'checking'} onClick={() => void open()}>
        {t(opening ? 'Opening…' : action)}
      </button>
    </div>
  </div>
}
