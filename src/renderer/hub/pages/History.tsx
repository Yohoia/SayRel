import { useAppText } from '../../shared/i18n/useAppText'
import { translateInterface } from '../../../shared/interfaceText'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, bridge } from '../../shared/utils/bridge'
import { Icon } from '../../shared/components/Icons'
import { Modal } from '../../shared/components/Modal'
import { ConfirmDialog } from '../../shared/components/ConfirmDialog'
import { toast } from '../../shared/components/Toast'
import { HubMenu } from '../components/HubMenu'
import { useAppSettings } from '../../shared/state/settings'
import { HubSelect } from '../components/HubSelect'

import type { HistoryListItem as Item } from '../../../shared/types'
import { refinementOutcomeSchema, refinementStatusText } from '../../../shared/refinement'
type Confirmation = { type: 'item'; item: Item } | { type: 'all' } | { type: 'retention'; days: number }
const FILTERS = [{ id: 'all', label: "All" }, { id: 'dictations', label: "Dictations" }, { id: 'ask_anything', label: "Ask anything" }]
const RETENTION = [{ value: 'never', label: "Never" }, { value: '1', label: "24 hours" }, { value: '7', label: "1 week" }, { value: '30', label: "1 month" }, { value: '365', label: "1 year" }, { value: '0', label: "Forever" }]

export function HistoryPage() {
  const t = useAppText()
  const { settings, locale, patch } = useAppSettings()
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [retrying, setRetrying] = useState<{ id: string; kind: 'retry' | 'refine' } | null>(null)
  const requestVersion = useRef(0)
  const sentinel = useRef<HTMLDivElement>(null)
  const [items, setItems] = useState<Item[]>([])
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<Item | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const load = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    try {
      const result = await api.history.list({ limit: 50, mode: filter === 'all' ? undefined : filter })
      if (version !== requestVersion.current) return
      setItems(result?.items ?? []); setTotal(result?.total ?? 0); setError('')
      setSelected(current => current ? result?.items?.find((item: Item) => item.id === current.id) ?? current : null)
    } catch { if (version === requestVersion.current) setError("Could not load history. Please try again.") }
    finally { if (version === requestVersion.current) setLoading(false) }
  }, [filter])
  const loadMore = useCallback(async () => {
    if (loading || loadingMore || items.length >= total) return
    const version = requestVersion.current
    setLoadingMore(true)
    try {
      const result = await api.history.list({ limit: 50, offset: items.length, mode: filter === 'all' ? undefined : filter })
      if (version !== requestVersion.current) return
      setItems((current) => [...current, ...(result?.items ?? []).filter((item: Item) => !current.some((entry) => entry.id === item.id))])
      setTotal(result?.total ?? 0); setError('')
    } catch { setError("Could not load more history. Please try again.") }
    finally { setLoadingMore(false) }
  }, [filter, items, total, loading, loadingMore])
  useEffect(() => {
    void load()
    const off = bridge.on('history:changed', load)
    window.addEventListener('focus', load)
    return () => { requestVersion.current++; off?.(); window.removeEventListener('focus', load) }
  }, [load])
  useEffect(() => {
    const node = sentinel.current
    if (!node || loading || error) return
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void loadMore() }, { rootMargin: '200px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadMore, loading, error])
  const retry = async (item: Item, kind: 'retry' | 'refine' = 'retry') => {
    if (retrying) return
    setMenu(null); setRetrying({ id: item.id, kind }); setError('')
    try {
      const result = await bridge.invoke(kind === 'refine' ? 'db:history-refine' : 'db:history-retry', item.id)
      if (!result) throw new Error('This recording is no longer available')
      const refinement = refinementOutcomeSchema.safeParse(result?.refinement)
      setSelected(current => current?.id === item.id ? { ...current, refinedText: result.refinedText,
        refinement: refinement.success ? refinement.data : current.refinement } : current)
      await load()
      if (refinement.success && refinement.data.kind === 'fallback') toast.error(t('Text refinement failed. Your original transcript is available.'))
      else toast.success(t(refinement.success ? refinementStatusText(refinement.data) ?? 'Retry completed' : 'Retry completed'))
    }
    catch (error) { const message = error instanceof Error ? error.message : "Could not retry. Please try again."; toast.error(message) }
    finally { setRetrying(null) }
  }
  const download = async (item: Item) => {
    setMenu(null)
    try { const result = await bridge.invoke('db:history-export-audio', item.id); if (!result?.canceled) toast.success("Saved") }
    catch { toast.error("Could not download audio. The file may have been removed.") }
  }
  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => { if (!(event.target as Element).closest('.hub-menu-anchor, .hub-action-menu')) setMenu(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null) }
    document.addEventListener('pointerdown', close); window.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [menu])
  const grouped = useMemo(() => {
    const groups = new Map<string, Item[]>()
    for (const item of items) {
      if (filter === 'dictations' && item.mode === 'ask_anything' || filter === 'ask_anything' && item.mode !== 'ask_anything') continue
      const date = dayLabel(item.createdAt, locale)
      groups.set(date, [...(groups.get(date) ?? []), item])
    }
    return [...groups.entries()]
  }, [items, filter, locale])
  const copy = async (item: Item) => { try { await api.clipboard.writeText(item.refinedText ?? ''); setCopied(item.id); setTimeout(() => setCopied(null), 1500); toast.success("Copied") } catch { toast.error("Could not copy. Please try again.") } }
  const changeRetention = async (value: string) => {
    if (busy) return
    setBusy(true)
    try {
      if (value === 'never') {
        await patch({ historyEnabled: false })
        return
      }
      const days = Number(value)
      if (settings.historyEnabled && days === settings.historyRetentionDays) return
      const mayDelete = days > 0 && (!settings.historyEnabled || settings.historyRetentionDays === 0 || days < settings.historyRetentionDays)
      if (mayDelete) {
        const history = await api.history.list({ limit: 1 })
        if (history.total > 0) {
          setConfirmation({ type: 'retention', days })
          return
        }
      }
      await patch({ historyEnabled: true, historyRetentionDays: days })
    } catch { toast.error("Could not update retention. Please try again.") }
    finally { setBusy(false) }
  }
  const confirm = async () => {
    if (!confirmation || busy) return
    setBusy(true)
    try {
      if (confirmation.type === 'item') await api.history.remove(confirmation.item.id)
      else if (confirmation.type === 'all') await api.history.clear()
      else {
        await patch({ historyEnabled: true, historyRetentionDays: confirmation.days })
        await bridge.invoke('db:history-delete-by-duration', confirmation.days * 86_400_000)
      }
      setConfirmation(null); toast.success("Deleted"); await load()
    } catch { toast.error("Something went wrong. Please try again.") }
    finally { setBusy(false) }
  }
  return <div className="page history-page">
    <header className="page-heading"><div className="page-heading-copy"><h1 className="page-title">{t("History")}</h1></div><div className="page-actions hub-menu-anchor"><button className="icon-button" title={t("More")} aria-label={t("History actions")} aria-haspopup="menu" aria-expanded={menu === 'header'} onClick={() => setMenu(menu === 'header' ? null : 'header')}><Icon name="more" /></button>{menu === 'header' && <HubMenu onClose={() => setMenu(null)}><button role="menuitem" className="danger" disabled={!items.length} onClick={() => { setMenu(null); setConfirmation({ type: 'all' }) }}><Icon name="trash" size={14} />{t("Delete all")}</button></HubMenu>}</div></header>
    <section className="history-retention" aria-label={t("Keep history")}>
      <div className="history-retention-row"><div><h2><Icon name="history" size={14} />{t("Keep history")}</h2><p>{t("Choose how long to keep your history on this device.")}</p></div><HubSelect compact label={t("History retention")} value={settings.historyEnabled ? String(settings.historyRetentionDays) : 'never'} options={(RETENTION.some((option) => option.value === String(settings.historyRetentionDays)) ? RETENTION : [...RETENTION, { value: String(settings.historyRetentionDays), label: `${settings.historyRetentionDays} days` }]).map(option => ({ ...option, label:t(option.label) }))} disabled={busy} onChange={(value) => void changeRetention(value)} /></div>
      <div className="history-retention-row"><div><h2><Icon name="shield" size={14} />{t("Your data stays private")}</h2><p>{t("Your dictation history stays on this device.")}</p></div></div>
    </section>
    <div className="page-toolbar"><div className="segmented-tabs" role="tablist" aria-label={t("Recording type")}>{FILTERS.map((item) => <button key={item.id} role="tab" aria-selected={filter === item.id} onClick={() => setFilter(item.id)}>{t(item.label)}</button>)}</div></div>
    {error && <p role="alert" className="inline-error">{t(error)} <button className="text-button" onClick={() => void load()}>{t("Retry")}</button></p>}
    {loading ? <div className="hub-loading" role="status" aria-label={t("Loading")} /> : grouped.length ? <div className="history-list">{grouped.map(([day, group]) => <section className="history-group" key={day}><h2 className="history-date">{day}</h2><div className="history-day-items">{group.map((item) => <article className={`history-item ${menu === item.id ? 'is-menu-open' : ''}`} key={item.id}>
      <time className="history-item-time">{item.createdAt ? new Date(item.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</time>
      <p className={`history-item-text ${item.status === 'failed' ? 'history-item-failed' : ''}`}>{retrying?.id === item.id ? t(retrying.kind === 'refine' || item.refinement?.kind === 'fallback' ? 'Retrying refinement…' : "Reprocessing audio…") : item.refinedText || (item.status === 'failed' ? t("Your transcription was interrupted.") : (item.status === 'cancelled' || item.status === 'canceled') ? t("The transcription was dismissed.") : t("Audio is silent."))}{(item.mode === 'voice_transcript' || item.mode === 'voice_command') && refinementStatusText(item.refinement) && <span className={item.refinement?.kind === 'fallback' ? 'history-refinement-warning' : 'history-refinement-status'} role="status">{t(refinementStatusText(item.refinement) ?? '')}</span>}</p>
      <div className="history-item-actions">{item.mode === 'voice_transcript' && item.transcript && <button className="history-view-answer" onClick={() => setSelected(item)}>{t("View details")}</button>}{item.mode === 'ask_anything' && item.refinedText && <button className="history-view-answer" onClick={() => setSelected(item)}>{t("View answer")}</button>}<button className="icon-button" title={copied === item.id ? t("Copied") : t("Copy transcript")} aria-label={t("Copy transcript")} disabled={!item.refinedText} onClick={() => void copy(item)}><Icon name={copied === item.id ? 'check' : 'copy'} size={14} /></button><div className="hub-menu-anchor"><button className="icon-button" title={t("More")} aria-label={t("Transcription actions")} aria-haspopup="menu" aria-expanded={menu === item.id} onClick={() => setMenu(menu === item.id ? null : item.id)}><Icon name="more" size={14} /></button>{menu === item.id && <HubMenu onClose={() => setMenu(null)}><button role="menuitem" disabled={(!item.hasAudio && item.refinement?.kind !== "fallback") || !!retrying} title={!item.hasAudio && item.refinement?.kind !== "fallback" ? t("No audio was saved for this recording") : undefined} onClick={() => void retry(item)}>{retrying?.id === item.id ? t("Retrying…") : t(item.refinement?.kind === "fallback" ? "Retry refinement" : "Retry")}</button>{item.mode === 'voice_transcript' && item.transcript?.trim() && <button role="menuitem" disabled={!!retrying} onClick={() => void retry(item, 'refine')}>{t('Refine again with current settings')}</button>}<button role="menuitem" disabled={!item.hasAudio} title={!item.hasAudio ? t("No audio was saved for this recording") : undefined} onClick={() => void download(item)}><Icon name="download" size={14} />{t("Download audio")}</button><hr /><button role="menuitem" className="danger" onClick={() => { setMenu(null); setConfirmation({ type: 'item', item }) }}><Icon name="trash" size={14} />{t("Delete transcript")}</button></HubMenu>}</div></div>
    </article>)}</div></section>)}</div> : <div className="empty-state history-empty"><h2>{t("No dictations yet")}</h2><p>{t("Your dictations from other apps will appear here.")}</p></div>}
    {!loading && items.length < total && <div ref={sentinel} className="history-load-more"><button className="text-button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? t("Loading…") : t("Load more")}</button></div>}
    {selected && <Modal title={t(selected.mode === 'ask_anything' ? 'Answer' : 'Transcription details')} onClose={() => setSelected(null)}>
      {selected.mode === 'ask_anything' ? <div className="detail-transcript">{selected.refinedText}</div> : <>
        {refinementStatusText(selected.refinement) && <p className="detail-meta" role="status">{t(refinementStatusText(selected.refinement) ?? '')}</p>}
        {selected.refinement && selected.refinement.kind !== 'skipped' && <p className="detail-meta">
          {selected.refinement.polishLevel && <span>{t('Cleanup level')}: {t(selected.refinement.polishLevel === 'strong' ? 'Deep cleanup' : selected.refinement.polishLevel === 'light' ? 'Light cleanup' : 'Original wording')}</span>}
          {selected.refinement.model && <span> · {selected.refinement.model}</span>}
          {selected.refinement.promptVersion && <span> · {selected.refinement.promptVersion}</span>}
        </p>}
        <div className="history-text-comparison">
          <section><h3>{t('Original transcript')}</h3><div className="detail-transcript">{selected.transcript ?? t('No original transcript is available for this dictation')}</div></section>
          <section><h3>{t('Writing result')}</h3><div className="detail-transcript">{selected.refinedText}</div></section>
        </div>
      </>}
      <footer className="modal-footer">
        {selected.mode === 'voice_transcript' && selected.transcript?.trim() && <button className="secondary-button" disabled={!!retrying} onClick={() => void retry(selected, 'refine')}>{t(retrying?.id === selected.id ? 'Retrying refinement…' : 'Refine again with current settings')}</button>}
        <button className="primary-button" onClick={() => void copy(selected)}><Icon name={copied === selected.id ? 'check' : 'copy'} />{copied === selected.id ? t("Copied") : t("Copy text")}</button>
      </footer>
    </Modal>}
    {confirmation && <ConfirmDialog title={confirmation.type === 'all' ? t("Delete all history?") : confirmation.type === 'item' ? t("Delete this transcript?") : t("Delete old history?")} description={confirmation.type === 'all' ? t("All your local history will be deleted forever. This can't be undone.") : confirmation.type === 'item' ? t("This transcript will be deleted forever. This can't be undone.") : t(`All local history older than ${t(RETENTION.find((option) => Number(option.value) === confirmation.days)?.label ?? `${confirmation.days} days`)} will be deleted forever. This can't be undone.`)} subject={confirmation.type === 'item' ? confirmation.item.refinedText ?? t("No transcript available") : undefined} pending={busy} onClose={() => { setConfirmation(null) }} onConfirm={() => void confirm()} />}
  </div>
}

function dayLabel(iso: string | null, locale: string): string {
  if (!iso) return translateInterface("Unknown date", locale)
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return translateInterface("Today", locale)
  if (date.toDateString() === yesterday.toDateString()) return translateInterface("Yesterday", locale)
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })
}
