import type { ComponentProps } from 'react'
import type { DictationUsage } from '../../../shared/usage'
import { useAppText } from '../../shared/i18n/useAppText'
import { useAppSettings } from '../../shared/state/settings'
import { Icon } from '../../shared/components/Icons'

function durationValue(ms: number | null) {
  return { value: ms === null ? null : ms / (ms >= 3600000 ? 3600000 : 60000), unit: ms !== null && ms >= 3600000 ? 'hr' : 'min' }
}

export function UsageStats({ stats }: { stats: DictationUsage | null }) {
  const t = useAppText()
  const { locale } = useAppSettings()
  const duration = durationValue(stats?.durationMs ?? null)
  const saved = durationValue(stats?.savedTimeMs ?? null)
  const metrics = [
    { key: 'duration', icon: 'clock', label: 'Dictation time', ...duration },
    { key: 'words', icon: 'mic', label: 'Words dictated', value: stats?.words ?? null, unit: 'words' },
    { key: 'speed', icon: 'bolt', label: 'Average speed', value: stats?.wordsPerMinute ?? null, unit: 'WPM' },
    { key: 'saved', icon: 'hourglass', label: 'Estimated time saved', ...saved },
    { key: 'personalization', icon: 'personal', label: 'Personalization', value: null, unit: '%' }
  ] satisfies { key: string; icon: ComponentProps<typeof Icon>['name']; label: string; value: number | null; unit: string }[]

  return <dl className="usage-stats" aria-label={t('Dictation statistics')}>{metrics.map(metric => <div className="usage-stat" key={metric.key} data-metric={metric.key}>
    <dt className="sr-only">{t(metric.label)}</dt>
    <dd>
      <Icon name={metric.icon} />
      <div className="usage-stat-value" data-compact={metric.value !== null && metric.value >= 1000 || undefined}><strong>{metric.value === null ? '—' : new Intl.NumberFormat(locale, metric.value >= 1000 ? { notation: 'compact', maximumSignificantDigits: 3, useGrouping: false } : { maximumFractionDigits: 1 }).format(metric.value)}</strong>{metric.value !== null && <span>{t(metric.unit)}</span>}</div>
    </dd>
  </div>)}</dl>
}
