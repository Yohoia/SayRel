import { useAppText } from '../../shared/i18n/useAppText'
import { BrandLockup } from '../../shared/components/BrandLockup'
import { NavLink } from 'react-router-dom'
import { Icon } from '../../shared/components/Icons'
import { useRecordingPhase } from '../state/recording'

const NAVIGATION = [
  {to:'/dashboard',label:"Home"}, {to:'/history',label:"History"},
  {to:'/dictionary',label:"Dictionary"}, {to:'/providers',label:"Providers"}
]
export function HubHeader({ onOpenSettings }: { onOpenSettings:(section?:string)=>void }) {
  const t = useAppText()
  const {phase,label}=useRecordingPhase()
  return <header className="home-header drag">
    <NavLink to="/dashboard" className="home-brand no-drag" aria-label={t("Sayrel home")}><BrandLockup /></NavLink>
    <nav className="home-navigation no-drag" aria-label={t("Main navigation")}>{NAVIGATION.map(item=><NavLink key={item.to} to={item.to}>{t(item.label)}</NavLink>)}</nav>
    <div className="home-status" role="status" data-phase={phase}><i aria-hidden="true" />{t(label)}</div>
    <button className="home-settings no-drag" onClick={()=>onOpenSettings('settings')} aria-label={t("Settings")} title={t("Settings")}><Icon name="settings" size={17} /></button>
  </header>
}
