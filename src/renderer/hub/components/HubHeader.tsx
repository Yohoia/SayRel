import { NavLink } from 'react-router-dom'
import { Icon } from '../../shared/components/Icons'
import { useRecordingPhase } from '../state/recording'

const NAVIGATION = [
  {to:'/dashboard',label:'首页'}, {to:'/history',label:'历史记录'},
  {to:'/dictionary',label:'词典'}, {to:'/providers',label:'服务商'}
]
export function HubHeader({ onOpenSettings }: { onOpenSettings:(section?:string)=>void }) {
  const {phase,label}=useRecordingPhase()
  return <header className="home-header drag">
    <NavLink to="/dashboard" className="home-brand no-drag" aria-label="Offkey 首页"><img className="brand-icon" src="./assets/brand/offkey-icon-128.png" alt="" width={24} height={24} /><span>Offkey</span></NavLink>
    <nav className="home-navigation no-drag" aria-label="主导航">{NAVIGATION.map(item=><NavLink key={item.to} to={item.to}>{item.label}</NavLink>)}</nav>
    <div className="home-status" role="status" data-phase={phase}><i aria-hidden="true" />{label}</div>
    <button className="home-settings no-drag" onClick={()=>onOpenSettings('settings')} aria-label="设置" title="设置"><Icon name="settings" size={17} /></button>
  </header>
}
