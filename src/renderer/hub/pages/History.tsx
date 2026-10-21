import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, bridge } from '../../shared/utils/bridge'
import { Icon } from '../../shared/components/Icons'
import { Modal } from '../../shared/components/Modal'
import { ConfirmDialog } from '../../shared/components/ConfirmDialog'
import { toast } from '../../shared/components/Toast'
import { HubMenu } from '../components/HubMenu'
import { useAppSettings } from '../state/settings'
import { HubSelect } from '../components/HubSelect'

import type { HistoryListItem as Item } from '../../../shared/types'
type Confirmation = { type: 'item'; item: Item } | { type: 'all' } | { type: 'retention'; days: number }
const FILTERS = [{ id: 'all', label: '全部' }, { id: 'dictations', label: '听写' }, { id: 'ask_anything', label: '问任何问题' }]
const RETENTION = [{ value: 'never', label: '从不' }, { value: '1', label: '24 小时' }, { value: '7', label: '1 周' }, { value: '30', label: '1 个月' }, { value: '365', label: '1 年' }, { value: '0', label: '永远' }]

export function HistoryPage() {
  const { settings, patch } = useAppSettings()
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
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
    } catch { if (version === requestVersion.current) setError('历史记录加载失败，请重试。') }
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
    } catch { setError('更多历史记录加载失败，请重试。') }
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
  const retry = async (item: Item) => {
    if (retrying) return
    setMenu(null); setRetrying(item.id); setError('')
    try { await bridge.invoke('db:history-retry', item.id); await load(); toast.success('已重试') }
    catch (error) { const message = error instanceof Error ? error.message : '重试失败，请再试一次。'; toast.error(message) }
    finally { setRetrying(null) }
  }
  const download = async (item: Item) => {
    setMenu(null)
    try { const result = await bridge.invoke('db:history-export-audio', item.id); if (!result?.canceled) toast.success('保存成功') }
    catch { toast.error('录音下载失败，文件可能已被清理') }
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
      const date = dayLabel(item.createdAt)
      groups.set(date, [...(groups.get(date) ?? []), item])
    }
    return [...groups.entries()]
  }, [items, filter])
  const copy = async (item: Item) => { try { await api.clipboard.writeText(item.refinedText ?? ''); setCopied(item.id); setTimeout(() => setCopied(null), 1500); toast.success('复制成功') } catch { toast.error('复制失败，请重试') } }
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
    } catch { toast.error('保留时间修改失败，请重试') }
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
      setConfirmation(null); toast.success('删除成功'); await load()
    } catch { toast.error('操作失败，请重试') }
    finally { setBusy(false) }
  }
  return <div className="page history-page">
    <header className="page-heading"><h1 className="page-title">历史记录</h1><div className="page-actions hub-menu-anchor"><button className="icon-button" title="更多" aria-label="历史记录操作" aria-haspopup="menu" aria-expanded={menu === 'header'} onClick={() => setMenu(menu === 'header' ? null : 'header')}><Icon name="more" /></button>{menu === 'header' && <HubMenu onClose={() => setMenu(null)}><button role="menuitem" className="danger" disabled={!items.length} onClick={() => { setMenu(null); setConfirmation({ type: 'all' }) }}><Icon name="trash" size={14} />删除所有</button></HubMenu>}</div></header>
    <section className="history-retention" aria-label="保存历史">
      <div className="history-retention-row"><div><h2><Icon name="history" size={14} />保存历史</h2><p>选择在此设备上保留历史记录的时间。</p></div><HubSelect compact label="保留历史记录的时间" value={settings.historyEnabled ? String(settings.historyRetentionDays) : 'never'} options={RETENTION.some((option) => option.value === String(settings.historyRetentionDays)) ? RETENTION : [...RETENTION, { value: String(settings.historyRetentionDays), label: `${settings.historyRetentionDays} 天` }]} disabled={busy} onChange={(value) => void changeRetention(value)} /></div>
      <div className="history-retention-row"><div><h2><Icon name="shield" size={14} />您的数据保持私密</h2><p>听写历史记录仅保存在这台设备上。</p></div></div>
    </section>
    <div className="page-toolbar"><div className="segmented-tabs" role="tablist" aria-label="记录类型">{FILTERS.map((item) => <button key={item.id} role="tab" aria-selected={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div></div>
    {error && <p role="alert" className="inline-error">{error} <button className="text-button" onClick={() => void load()}>重试</button></p>}
    {loading ? <div className="hub-loading" role="status" aria-label="正在加载" /> : grouped.length ? <div className="history-list">{grouped.map(([day, group]) => <section className="history-group" key={day}><h2 className="history-date">{day}</h2><div className="history-day-items">{group.map((item) => <article className={`history-item ${menu === item.id ? 'is-menu-open' : ''}`} key={item.id}>
      <time className="history-item-time">{item.createdAt ? new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</time>
      <p className={`history-item-text ${item.status === 'failed' ? 'history-item-failed' : ''}`}>{retrying === item.id ? '正在重新处理录音…' : item.refinedText || (item.status === 'failed' ? '您的转录被中断。' : (item.status === 'cancelled' || item.status === 'canceled') ? '转录已被取消。' : '音频无声。')}</p>
      <div className="history-item-actions">{item.mode === 'ask_anything' && item.refinedText && <button className="history-view-answer" onClick={() => setSelected(item)}>查看答案</button>}<button className="icon-button" title={copied === item.id ? '已复制' : '复制转录'} aria-label="复制转录" disabled={!item.refinedText} onClick={() => void copy(item)}><Icon name={copied === item.id ? 'check' : 'copy'} size={14} /></button><div className="hub-menu-anchor"><button className="icon-button" title="更多" aria-label="转录操作" aria-haspopup="menu" aria-expanded={menu === item.id} onClick={() => setMenu(menu === item.id ? null : item.id)}><Icon name="more" size={14} /></button>{menu === item.id && <HubMenu onClose={() => setMenu(null)}><button role="menuitem" disabled={!item.hasAudio || !!retrying} title={!item.hasAudio ? '此记录没有保存录音' : undefined} onClick={() => void retry(item)}>{retrying === item.id ? '正在重试…' : '重试'}</button><button role="menuitem" disabled={!item.hasAudio} title={!item.hasAudio ? '此记录没有保存录音' : undefined} onClick={() => void download(item)}><Icon name="download" size={14} />下载音频</button><hr /><button role="menuitem" className="danger" onClick={() => { setMenu(null); setConfirmation({ type: 'item', item }) }}><Icon name="trash" size={14} />删除转录</button></HubMenu>}</div></div>
    </article>)}</div></section>)}</div> : <div className="empty-state history-empty"><h2>尚无口述</h2><p>一旦您在不同应用中进行口述，您的所有口述历史将出现在这里。</p></div>}
    {!loading && items.length < total && <div ref={sentinel} className="history-load-more"><button className="text-button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? '正在加载…' : '加载更多'}</button></div>}
    {selected && <Modal title="回答" onClose={() => setSelected(null)}><div className="detail-transcript">{selected.refinedText}</div><footer className="modal-footer"><button className="primary-button" onClick={() => void copy(selected)}><Icon name={copied === selected.id ? 'check' : 'copy'} />{copied === selected.id ? '已复制' : '复制文字'}</button></footer></Modal>}
    {confirmation && <ConfirmDialog title={confirmation.type === 'all' ? '删除所有历史记录？' : confirmation.type === 'item' ? '删除此转录？' : '删除旧历史记录？'} description={confirmation.type === 'all' ? '您所有的本地历史记录将被永久删除，无法恢复。' : confirmation.type === 'item' ? '此转录将被永久删除，无法恢复。' : `您所有的本地历史记录早于 ${RETENTION.find((option) => Number(option.value) === confirmation.days)?.label} 将被永久删除，无法恢复。`} subject={confirmation.type === 'item' ? confirmation.item.refinedText ?? '暂无转写文字' : undefined} pending={busy} onClose={() => { setConfirmation(null) }} onConfirm={() => void confirm()} />}
  </div>
}

function dayLabel(iso: string | null): string {
  if (!iso) return '日期未知'
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return '今天'
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}
