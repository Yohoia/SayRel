import { useRef, useState, type KeyboardEvent } from 'react'
import { buildActivity, type ActivitySummary } from '../../../shared/activity'
import { useAppText } from '../../shared/i18n/useAppText'
import { useAppSettings } from '../../shared/state/settings'
import type { DictationUsage } from '../../../shared/usage'
import { UsageStats } from './UsageStats'

type ActivityState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; activity: ActivitySummary; stats: DictationUsage }
const emptyActivity = buildActivity({ days: [] })

export function ActivityHeatmap({ state, onRetry }: { state: ActivityState; onRetry: () => void }) {
  const t = useAppText()
  const { locale } = useAppSettings()
  const activity = state.status === 'ready' ? state.activity : emptyActivity
  const [hovered, setHovered] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const dateFormat = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', year: 'numeric' })
  const monthFormat = new Intl.DateTimeFormat(locale, { month: 'short' })
  const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
  const selected = activity.days.find(day => day.key === (hovered ?? focused))
  const visibleRecordings = activity.days.reduce((sum, day) => sum + day.count, 0)
  const describeDay = (day: ActivitySummary['days'][number]) => t(day.count === 1
    ? `${day.count.toLocaleString(locale)} recording on ${dateFormat.format(day.date)}`
    : `${day.count.toLocaleString(locale)} recordings on ${dateFormat.format(day.date)}`)
  const metrics = [
    { label: 'Active days', value: activity.activeDays },
    { label: 'Current streak', value: activity.currentStreak },
    { label: 'Longest streak', value: activity.longestStreak }
  ]
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const dayOfWeek = index % 7
    const next = event.key === 'ArrowLeft' ? index - 7 : event.key === 'ArrowRight' ? index + 7
      : event.key === 'ArrowUp' && dayOfWeek > 0 ? index - 1 : event.key === 'ArrowDown' && dayOfWeek < 6 ? index + 1
        : event.key === 'Home' ? dayOfWeek : event.key === 'End' ? 25 * 7 + dayOfWeek : -1
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const target = activity.days[event.key === 'End' && activity.days[next]?.future ? next - 7 : next]
    if (target && !target.future) grid.current?.querySelector<HTMLButtonElement>(`[data-date="${target.key}"]`)?.focus()
  }
  return <section className="home-activity" aria-label={t('Recording activity')} aria-busy={state.status === 'loading'}>
    <UsageStats stats={state.status === 'ready' ? state.stats : null} />
    <div className="activity-panel" data-state={state.status}>
      <div className="activity-metrics">{metrics.map(metric => <div className="activity-metric" key={metric.label}>
        <div><strong>{state.status === 'ready' ? metric.value.toLocaleString(locale) : '—'}</strong><span>{t(metric.value === 1 ? 'day' : 'days')}</span></div>
        <p>{t(metric.label)}</p>
      </div>)}</div>
      <div className="activity-calendar">
        <span className="activity-period">{t('Last 26 weeks')}</span>
        <div className="activity-months" aria-hidden="true">{activity.days.map((day, index) => !day.future && ((index === 0 && activity.days[6].date.getMonth() === day.date.getMonth()) || day.date.getDate() === 1)
          ? <span key={day.key} style={{ gridColumn: Math.floor(index / 7) + 1 }}>{monthFormat.format(day.date)}</span> : null)}</div>
        <div className="activity-weekdays" aria-hidden="true">{activity.days.slice(0, 7).map(day => <span key={day.key}>{weekdayFormat.format(day.date)}</span>)}</div>
        <div className="activity-grid" role="grid" aria-label={t('Daily recording activity')} aria-rowcount={7} aria-colcount={26} ref={grid}
          onMouseLeave={() => setHovered(null)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null) }}>
          {Array.from({ length: 7 }, (_, weekday) => <div className="activity-weekday-row" role="row" key={weekday}>
            {activity.days.filter((_, index) => index % 7 === weekday).map((day, week) => <button type="button" role="gridcell" className="activity-day" key={day.key}
              data-level={state.status === 'ready' ? day.level : 0} data-date={day.key} data-future={day.future || undefined}
              disabled={day.future || state.status !== 'ready'} tabIndex={day.key === (focused ?? activity.today) ? 0 : -1}
              aria-label={describeDay(day)}
              onMouseEnter={() => setHovered(day.key)} onFocus={() => setFocused(day.key)} onKeyDown={event => moveFocus(event, week * 7 + weekday)} />)}
          </div>)}
        </div>
      </div>
      <div className="activity-caption">
        <p className="activity-detail" aria-live="polite">{state.status === 'loading' ? t('Loading…') : state.status === 'error' ? t('Could not load activity.')
          : selected ? describeDay(selected)
            : activity.activeDays === 0 ? t('Your first recording starts the pattern.')
              : t(`${visibleRecordings.toLocaleString(locale)} ${visibleRecordings === 1 ? 'recording' : 'recordings'} in 26 weeks`)}</p>
        {state.status === 'error' ? <button className="activity-retry" onClick={onRetry}>{t('Retry')}</button>
          : <div className="activity-legend" aria-label={t('Color shows recordings per day: 0, 1–2, 3–5, 6–9, 10 or more.')}><span>{t('Less')}</span>{[0, 1, 2, 3, 4].map(level => <i data-level={level} key={level} />)}<span>{t('More')}</span></div>}
      </div>
    </div>
  </section>
}
