import { NavLink } from 'react-router-dom'
import { Icon } from '../../shared/components/Icons'
import { api } from '../../shared/utils/bridge'

const ITEMS = [
  { to: '/dashboard', label: "首页", icon: 'home' as const },
  { to: '/history', label: "历史记录", icon: 'history' as const },
  { to: '/dictionary', label: "词典", icon: 'dictionary' as const },
  { to: '/providers', label: "服务商", icon: 'settings' as const }
]

export function SideNav({ onOpenSettings }: { onOpenSettings: (section?: string) => void }) {
  return <aside className="app-sidebar drag">
    <div className="sidebar-surface">
      <div className="sidebar-brand"><img className="brand-horizontal" src="./assets/brand/offkey-logo-horizontal-800x250.png" width={140} height={44} alt="Offkey" /></div>
      <nav aria-label="主导航" className="sidebar-navigation no-drag">
        {ITEMS.map((item) => <NavLink key={item.to} to={item.to} className={({ isActive }) => 'sidebar-link' + (isActive ? ' is-active' : '')}><Icon name={item.icon} /><span>{item.label}</span></NavLink>)}
      </nav>
      <div className="sidebar-bottom no-drag">
        <div className="sidebar-utilities">
          <button className="icon-button" title="账户" aria-label="账户" onClick={() => onOpenSettings('account')}><Icon name="user" /></button>
          <div className="sidebar-utilities-end">
            <button className="icon-button" title="联系我们" aria-label="联系我们" onClick={() => void api.page.openUrl('https://www.typeless.com/contact')}><Icon name="mail" /></button>
            <button className="icon-button" title="设置" aria-label="设置" onClick={() => onOpenSettings('general')}><Icon name="settings" /></button>
            <button className="icon-button" title="帮助" aria-label="帮助" onClick={() => onOpenSettings('help')}><Icon name="help" /></button>
          </div>
        </div>
      </div>
    </div>
  </aside>
}
