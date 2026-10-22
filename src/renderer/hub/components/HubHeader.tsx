import { useAppText } from '../../shared/i18n/useAppText'
import { BrandLockup } from '../../shared/components/BrandLockup'
import { NavLink } from 'react-router-dom'
import { Icon } from '../../shared/components/Icons'

const NAVIGATION = [
  {to:'/dashboard',label:"Home"}, {to:'/statistics',label:"Statistics"}, {to:'/history',label:"History"},
  {to:'/dictionary',label:"Dictionary"}, {to:'/providers',label:"Providers"}
]
export function HubHeader({ onOpenSettings }: { onOpenSettings:(section?:string)=>void }) {
  const t = useAppText()
  return <header className="home-header drag">
    <NavLink to="/dashboard" className="home-brand no-drag" aria-label={t("Sayrel home")}><BrandLockup /></NavLink>
    <nav className="home-navigation no-drag" aria-label={t("Main navigation")}>{NAVIGATION.map(item=><NavLink key={item.to} to={item.to}>{t(item.label)}</NavLink>)}</nav>
    <button className="home-settings no-drag" onClick={()=>onOpenSettings('settings')} aria-label={t("Settings")} title={t("Settings")}><Icon name="settings" size={17} /></button>
  </header>
}
