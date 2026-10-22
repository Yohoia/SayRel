import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppText } from '../../shared/i18n/useAppText'
import { api, bridge } from '../../shared/utils/bridge'
import { ActivityHeatmap } from '../components/ActivityHeatmap'
import { HomeApplications } from '../components/HomeApplications'
import { HomeFooter } from '../components/HomeFooter'
import { buildActivity, historyActivitySchema, type ActivitySummary } from '../../../shared/activity'
import { dictationUsageSchema, type DictationUsage } from '../../../shared/usage'

type Usage = { status: 'loading' } | { status: 'error' } | { status: 'ready'; stats: DictationUsage; activity: ActivitySummary }

export function StatisticsPage() {
  const t = useAppText()
  const [usage, setUsage] = useState<Usage>({ status: 'loading' })
  const usageRequest = useRef(0)
  const mounted = useRef(false)
  const loadUsage = useCallback(async () => {
    const request = ++usageRequest.current
    setUsage(current => current.status === 'ready' ? current : { status: 'loading' })
    try {
      const [usageResult, activityResult] = await Promise.all([api.history.usage(), api.history.activity()])
      const stats = dictationUsageSchema.parse(usageResult)
      const activity = buildActivity(historyActivitySchema.parse(activityResult))
      if (mounted.current && request === usageRequest.current) setUsage({ status: 'ready', activity, stats })
    } catch {
      if (mounted.current && request === usageRequest.current) setUsage({ status: 'error' })
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    void loadUsage()
    const offHistory = bridge.on('history:changed', loadUsage)
    window.addEventListener('focus', loadUsage)
    return () => { mounted.current = false; offHistory?.(); window.removeEventListener('focus', loadUsage) }
  }, [loadUsage])
  return <div className="page home-canvas statistics-page">
    <header className="home-statistics-header"><h1 className="page-title">{t('Usage overview')}</h1><p>{t('Your voice input and daily activity at a glance.')}</p></header>
    <div className="statistics-body"><ActivityHeatmap state={usage} onRetry={() => void loadUsage()} /></div>
    <HomeApplications />
    <HomeFooter />
  </div>
}
