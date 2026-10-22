import { useAppText } from '../shared/i18n/useAppText'
import { useEffect, useState } from 'react'
import CloseRounded from '@mui/icons-material/CloseRounded'
import RefreshRounded from '@mui/icons-material/RefreshRounded'
import SettingsRounded from '@mui/icons-material/SettingsRounded'
import TextFieldsRounded from '@mui/icons-material/TextFieldsRounded'
import EditRounded from '@mui/icons-material/EditRounded'
import type { AudioContextSnapshot } from '../../shared/types'
import { api, bridge } from '../shared/utils/bridge'
import { toast } from '../shared/components/Toast'
import '../shared/styles/secondary.css'

// Typeless BUWw_RCU:13–333 is the context inspector, not a second recorder.
const POSITIONS = { 'top-left': "Top left", 'top-right': "Top right", 'bottom-left': "Bottom left", 'bottom-right': "Bottom right" }
export function SidebarApp() {
  const t = useAppText()
  const [snapshot, setSnapshot] = useState<AudioContextSnapshot | null>(null)
  const [icon, setIcon] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState(false)
  const [full, setFull] = useState(false)
  const [position, setPosition] = useState(localStorage.getItem('debug_window_position') || 'bottom-right')
  const refresh = async () => {
    setBusy(true)
    try { setSnapshot(await bridge.invoke('context:get-audio-context')) }
    catch { toast.error("Could not read context from the current app") }
    finally { setBusy(false) }
  }
  const changePosition = async (value: string) => {
    try {
      const display = screen as Screen & { availLeft?: number; availTop?: number }
      const left = value.endsWith('left')
      const top = value.startsWith('top')
      const moved = await bridge.invoke('page:set-debug-window-position', 'sidebar.html',
        (display.availLeft ?? 0) + (left ? 0 : screen.availWidth - window.outerWidth),
        (display.availTop ?? 0) + (top ? 0 : screen.availHeight - window.outerHeight))
      if (!moved) { toast.error("Could not move the window. Please try again."); return }
      localStorage.setItem('debug_window_position', value)
      setPosition(value)
    } catch { toast.error("Could not move the window. Please try again.") }
  }
  const copy = async () => {
    try { await api.clipboard.writeText(JSON.stringify(snapshot || {}, null, 2)); toast.success("Copied") }
    catch { toast.error("Could not copy. Please try again.") }
  }
  const focusedApp = snapshot?.focusedApp
  const focusedInput = snapshot?.focusedInput
  useEffect(() => {
    let cancelled = false
    setIcon(null)
    if (focusedApp?.bundleId) void bridge.invoke('context:get-app-icon', focusedApp.bundleId).then((value: string | null) => { if (!cancelled) setIcon(value) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [focusedApp?.bundleId])
  const summary = snapshot ? { active_application: focusedApp, text_insertion_point: focusedInput } : {}
  return <main className="secondary-sidebar">
    <header className="secondary-sidebar-header drag">
      <div className="secondary-context-app"><i>{icon && <img src={icon} width={20} height={20} alt="" />}</i><span>{focusedApp?.appName || t("No app")}</span><small>{focusedApp?.windowTitle}</small></div>
      <div className="secondary-context-actions no-drag">
        {busy && <i className="secondary-context-busy" />}
        <button className="secondary-icon-button" onClick={() => void refresh()} title={t("Refresh")} aria-label={t("Refresh")} disabled={busy}><RefreshRounded /></button>
        <button className="secondary-icon-button" onClick={() => setSettings(!settings)} title={t("Settings")} aria-label={t("Settings")} aria-pressed={settings}><SettingsRounded /></button>
        <button className="secondary-icon-button" onClick={() => void api.page.closeSidebar()} title={t("Close")} aria-label={t("Close")}><CloseRounded /></button>
      </div>
    </header>
    <div className="secondary-sidebar-body">
      {settings && <section className="secondary-context-position"><span>{t("Window position:")}</span><div>{Object.entries(POSITIONS).map(([value, label]) => <button key={value} className={value === position ? 'selected' : ''} onClick={() => void changePosition(value)}>{t(label)}</button>)}</div></section>}
      {!focusedInput ? <section className="secondary-context-empty"><TextFieldsRounded /><p>{t("No text cursor detected")}</p><small>{t("Click a text field, then refresh to see cursor context")}</small></section> : <section className="secondary-context-cursor"><header><span><EditRounded />{t("Cursor context")}</span><small>{focusedInput.role || t("Unknown")}</small></header><div>
        {focusedInput.selectedText && <><h2>{t("Selected text")}</h2><p className="secondary-context-selection">{focusedInput.selectedText}</p></>}
        {focusedInput.valuePreview && <><h2>{t("Text field content")}</h2><p>{focusedInput.valuePreview}</p></>}
        {!focusedInput.selectedText && !focusedInput.valuePreview && <p>{t("The cursor is in an empty position")}</p>}
      </div></section>}
      {(focusedApp?.webDomain || focusedApp?.webUrl) && <section className="secondary-context-browser"><h2>{t("Browser context")}</h2><dl><dt>{t("Domain")}</dt><dd>{focusedApp.webDomain}</dd><dt>{t("URL")}</dt><dd>{focusedApp.webUrl}</dd></dl></section>}
      <section className="secondary-context-data"><header><h1>{t("Context data")}</h1><div><button onClick={() => setFull(!full)}>{full ? t("Show summary") : t("Show all")}</button><button onClick={() => void copy()}>{t("Copy")}</button></div></header><pre>{JSON.stringify(full ? snapshot || {} : summary, null, 2)}</pre></section>
    </div>
  </main>
}
