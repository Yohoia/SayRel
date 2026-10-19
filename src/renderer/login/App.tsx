import { Fragment, useEffect, useState } from 'react'
import { api } from '../shared/bridge'
import '../shared/secondary.css'

// Typeless 2.8.2: Cql4ZCsL login shell and BebSff9M authentication card.
const PROVIDERS = [
  { id: 'google', label: '使用 Google 继续' },
  { id: 'email', label: '使用电子邮件继续' },
  { id: 'apple', label: '使用 Apple 继续' },
  { id: 'sso', label: '使用 SSO 继续' }
]
export function LoginApp() {
  const [waiting, setWaiting] = useState(false)
  const [remoteWaiting, setRemoteWaiting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    const off = window.offkey?.on?.('auth:app-login-failed', () => {
      setWaiting(false)
      setRemoteWaiting(false)
      setMessage('无法登录。选择一个选项重试。')
    })
    const offLoading = window.offkey?.on?.('auth:app-login-loading-changed', (value: boolean) => setRemoteWaiting(value === true))
    return () => { off?.(); offLoading?.() }
  }, [])
  const start = async (provider: string) => {
    setWaiting(true)
    setMessage(null)
    try { await window.offkey.invoke('auth:start-app-login', provider) }
    catch { setMessage('无法登录。选择一个选项重试。') }
    finally { setWaiting(false) }
  }
  return <main className="secondary-login">
    <div className="secondary-titlebar drag" />
    <section className="secondary-login-card no-drag">
      <div className="secondary-login-heading">
        <img src="./assets/brand/offkey-icon-128.png" width={48} height={48} alt="Offkey" />
        <div><h1>欢迎使用 Offkey</h1><p>说话，不要打字</p></div>
      </div>
      <div className="secondary-login-providers">{PROVIDERS.map((provider, i) => <Fragment key={provider.id}><button aria-label={provider.label} style={{ gridRow: i + 1 }} className={'secondary-provider-button ' + (provider.id === 'google' ? 'is-primary' : '')} disabled={waiting || remoteWaiting} onClick={() => void start(provider.id)} /><img className="secondary-provider-icon" style={{ gridRow: i + 1 }} src={'./assets/login-' + provider.id + '.svg'} width={20} height={20} alt="" /><span className={'secondary-provider-label ' + (provider.id === 'google' ? 'is-primary' : '')} style={{ gridRow: i + 1 }}>{provider.label}</span></Fragment>)}</div>
      <p className="secondary-login-terms">注册即表示您同意 <button onClick={() => void api.page.openUrl('https://www.typeless.com/terms')}>服务条款</button> 和 <button onClick={() => void api.page.openUrl('https://www.typeless.com/privacy')}>隐私政策</button></p>
      {message && <p className="secondary-error" role="alert">{message}</p>}
      {(waiting || remoteWaiting) && <div className="secondary-login-loading" role="status" aria-label="正在登录"><span /></div>}
    </section>
  </main>
}
