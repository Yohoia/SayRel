import { NavLink } from 'react-router-dom'
import { Icon } from '../../shared/components/Icons'
import { useRecordingPhase } from '../state/recording'

const NAVIGATION = [
  {to:'/dashboard',label:"Home"}, {to:'/history',label:"History"},
  {to:'/dictionary',label:"Dictionary"}, {to:'/providers',label:"Providers"}
]
export function HubHeader({ onOpenSettings }: { onOpenSettings:(section?:string)=>void }) {
  const {phase,label}=useRecordingPhase()
  return <header className="home-header drag">
    <NavLink to="/dashboard" className="home-brand no-drag" aria-label="Sayrel home"><img className="brand-lockup" src="./assets/brand/sayrel-horizontal.svg" alt="Sayrel" width={100} height={33} /></NavLink>
    <nav className="home-navigation no-drag" aria-label="Main navigation">{NAVIGATION.map(item=><NavLink key={item.to} to={item.to}>{item.label}</NavLink>)}</nav>
    <div className="home-status" role="status" data-phase={phase}><i aria-hidden="true" />{label}</div>
    <button className="home-settings no-drag" onClick={()=>onOpenSettings('settings')} aria-label="Settings" title="Settings"><Icon name="settings" size={17} /></button>
  </header>
}
