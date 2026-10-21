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
const POSITIONS = { 'top-left': '左上角', 'top-right': '右上角', 'bottom-left': '左下角', 'bottom-right': '右下角' }
export function SidebarApp() {
  const [snapshot, setSnapshot] = useState<AudioContextSnapshot | null>(null)
  const [icon, setIcon] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState(false)
  const [full, setFull] = useState(false)
  const [position, setPosition] = useState(localStorage.getItem('debug_window_position') || 'bottom-right')
  const refresh = async () => {
    setBusy(true)
    try { setSnapshot(await bridge.invoke('context:get-audio-context')) }
    catch { toast.error('无法读取当前应用的上下文') }
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
      if (!moved) { toast.error('无法调整窗口位置，请重试'); return }
      localStorage.setItem('debug_window_position', value)
      setPosition(value)
    } catch { toast.error('无法调整窗口位置，请重试') }
  }
  const copy = async () => {
    try { await api.clipboard.writeText(JSON.stringify(snapshot || {}, null, 2)); toast.success('复制成功') }
    catch { toast.error('复制失败，请重试') }
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
      <div className="secondary-context-app"><i>{icon && <img src={icon} width={20} height={20} alt="" />}</i><span>{focusedApp?.appName || '无应用'}</span><small>{focusedApp?.windowTitle}</small></div>
      <div className="secondary-context-actions no-drag">
        {busy && <i className="secondary-context-busy" />}
        <button className="secondary-icon-button" onClick={() => void refresh()} title="刷新" aria-label="刷新" disabled={busy}><RefreshRounded /></button>
        <button className="secondary-icon-button" onClick={() => setSettings(!settings)} title="设置" aria-label="设置" aria-pressed={settings}><SettingsRounded /></button>
        <button className="secondary-icon-button" onClick={() => void api.page.closeSidebar()} title="关闭" aria-label="关闭"><CloseRounded /></button>
      </div>
    </header>
    <div className="secondary-sidebar-body">
      {settings && <section className="secondary-context-position"><span>窗口位置：</span><div>{Object.entries(POSITIONS).map(([value, label]) => <button key={value} className={value === position ? 'selected' : ''} onClick={() => void changePosition(value)}>{label}</button>)}</div></section>}
      {!focusedInput ? <section className="secondary-context-empty"><TextFieldsRounded /><p>未检测到文本插入点</p><small>点击文本框，然后刷新以查看光标上下文</small></section> : <section className="secondary-context-cursor"><header><span><EditRounded />光标上下文</span><small>{focusedInput.role || '未知'}</small></header><div>
        {focusedInput.selectedText && <><h2>选中的文本</h2><p className="secondary-context-selection">{focusedInput.selectedText}</p></>}
        {focusedInput.valuePreview && <><h2>输入框文本</h2><p>{focusedInput.valuePreview}</p></>}
        {!focusedInput.selectedText && !focusedInput.valuePreview && <p>光标位于空白位置</p>}
      </div></section>}
      {(focusedApp?.webDomain || focusedApp?.webUrl) && <section className="secondary-context-browser"><h2>浏览器上下文</h2><dl><dt>域名</dt><dd>{focusedApp.webDomain}</dd><dt>URL</dt><dd>{focusedApp.webUrl}</dd></dl></section>}
      <section className="secondary-context-data"><header><h1>上下文数据</h1><div><button onClick={() => setFull(!full)}>{full ? '显示摘要' : '显示全部'}</button><button onClick={() => void copy()}>复制</button></div></header><pre>{JSON.stringify(full ? snapshot || {} : summary, null, 2)}</pre></section>
    </div>
  </main>
}
