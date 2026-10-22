import { useAppText } from '../../shared/i18n/useAppText'
import { api } from '../../shared/utils/bridge'
import { toast } from '../../shared/components/Toast'

const APPLICATIONS = [
  { name: 'Gmail', url: 'https://mail.google.com/' },
  { name: 'Slack', url: 'https://app.slack.com/' },
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { name: 'Notion', url: 'https://www.notion.so/' },
  { name: 'Google Docs', url: 'https://docs.google.com/' }
]

export function HomeApplications() {
  const t = useAppText()
  return <section className="home-applications" aria-label={t('Use Sayrel in your everyday apps')}>
    <p>{t('Everyday apps')}</p>
    <div className="home-stamps">{APPLICATIONS.map((app, index) => <button key={app.name} className="home-stamp" onClick={() => void api.page.openUrl(app.url).catch(() => toast.error('Could not open the app. Please try again.'))} aria-label={t('Open ' + app.name)} title={t('Open ' + app.name)}>
      <span>{app.name}</span><small>0{index + 1}</small><span className="home-stamp-arrow" aria-hidden="true">↗</span>
    </button>)}</div>
  </section>
}
