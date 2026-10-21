import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../shared/utils/bridge'
import { Icon } from '../../shared/components/Icons'
import { Modal } from '../../shared/components/Modal'
import { ConfirmDialog } from '../../shared/components/ConfirmDialog'
import { toast } from '../../shared/components/Toast'
import { HubMenu } from '../components/HubMenu'
import { DictionaryGlyph } from '../components/DictionaryGlyph'
import '../../shared/styles/dictionary.css'

type Entry = { id: string; word: string; source: string; language: string | null; createdAt: string }
type ImportEntry = { word: string; language?: string }
const FILTERS = [{ id: 'all', label: '所有' }, { id: 'auto', label: '自动添加' }, { id: 'manual', label: '手动添加' }]

export function DictionaryPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [editing, setEditing] = useState<Entry | null>(null)
  const [newWord, setNewWord] = useState(false)
  const [deleting, setDeleting] = useState<Entry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState<{ entries: ImportEntry[]; fileName: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { const list = await api.dictionary.list(); setEntries(Array.isArray(list) ? list : []); setError('') }
    catch { setError('词典加载失败，请重试。') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => { if (!(event.target as Element).closest('.dictionary-word, .hub-action-menu')) setMenu(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null) }
    document.addEventListener('pointerdown', close); window.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [menu])
  const visible = useMemo(() => entries.filter((entry) => (filter === 'all' || (filter === 'auto' ? entry.source === 'auto' : entry.source !== 'auto')) && entry.word.toLowerCase().includes(search.toLowerCase())), [entries, filter, search])
  const multiSelect = selected.size > 0
  const allSelected = !!visible.length && visible.every((entry) => selected.has(entry.id))
  const toggle = (id: string) => { setMenu(null); setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  const closeAdd = () => { if (!busy) { setNewWord(false); setPreview(null) } }
  const add = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!draft.trim() || busy) return
    setBusy(true)
    try { await api.dictionary.add(draft.trim()); await load(); setNewWord(false); setDraft(''); toast.success('保存成功') }
    catch { toast.error('保存失败，请重试') }
    finally { setBusy(false) }
  }
  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editing || busy || !draft.trim()) return
    setBusy(true)
    try {
      const updated = await api.dictionary.update(editing.id, draft.trim())
      setEntries((current) => current.map((entry) => entry.id === editing.id ? updated : entry))
      setEditing(null); setDraft(''); toast.success('保存成功')
    } catch (error) { toast.error(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '保存失败，请重试') }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!deleting.length || busy) return
    setBusy(true)
    const removed = new Set<string>()
    try {
      for (const entry of deleting) { await api.dictionary.remove(entry.id); removed.add(entry.id) }
      setDeleting([]); toast.success('删除成功')
    } catch { toast.error('删除失败，请重试'); setDeleting((current) => current.filter((entry) => !removed.has(entry.id))) }
    finally {
      setEntries((items) => items.filter((item) => !removed.has(item.id)))
      setSelected((current) => new Set([...current].filter((id) => !removed.has(id))))
      setBusy(false)
    }
  }
  const importCsv = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await api.files.importDictionary()
      if (!result || result.canceled) return
      const known = new Set(entries.map((entry) => entry.word.toLocaleLowerCase()))
      const valid: ImportEntry[] = []
      for (const entry of result.entries ?? []) {
        const word = String(entry.word ?? '').trim()
        if (!word || word.length > 100 || known.has(word.toLocaleLowerCase())) continue
        known.add(word.toLocaleLowerCase()); valid.push({ word, language: entry.language })
      }
      if (!valid.length) { toast.info('未找到可导入的词条'); return }
      setPreview({ entries: valid, fileName: result.fileName ?? 'CSV 文件' })
    } catch { toast.error('文件读取失败') }
    finally { setBusy(false) }
  }
  const importPreview = async () => {
    if (!preview || busy) return
    setBusy(true)
    let imported = 0
    try {
      for (const entry of preview.entries) { await api.dictionary.add(entry.word, { source: 'csv', language: entry.language }); imported++ }
      setPreview(null); setNewWord(false); setDraft(''); toast.success('导入成功')
    } catch { setPreview({ ...preview, entries: preview.entries.slice(imported) }); toast.error('导入失败，请重试') }
    finally { await load(); setBusy(false) }
  }
  return <div className="page dictionary-page">
    <header className="page-heading"><div className="page-heading-copy"><p className="page-index">03 / LEXICON</p><h1 className="page-title">词典</h1></div><div className="page-actions"><button className="primary-button" onClick={() => { setNewWord(true); setDraft(''); setPreview(null) }}><Icon name="plus" />新词</button></div></header>
    {multiSelect ? <div className="dictionary-selection"><button className="icon-button" aria-label={allSelected ? '清除选择' : '全选'} role="checkbox" aria-checked={allSelected ? true : 'mixed'} onClick={() => setSelected(allSelected ? new Set() : new Set(visible.map((entry) => entry.id)))}><DictionaryGlyph name={allSelected ? 'checked' : 'mixed'} /></button><span>已选择 {selected.size} 个词</span><button className="dictionary-selection-delete" onClick={() => { setDeleting(entries.filter((entry) => selected.has(entry.id))) }}><Icon name="trash" size={14} />删除</button></div> : <div className="page-toolbar"><div className="segmented-tabs" role="tablist" aria-label="词条来源">{FILTERS.map((item) => <button key={item.id} role="tab" aria-selected={filter === item.id} onClick={() => setFilter(item.id)}>{item.id === 'auto' && <Icon name="sparkle" size={14} className="auto-word" />}{item.id === 'manual' && <DictionaryGlyph name="manual" />}{item.label}</button>)}</div>{searchOpen ? <label className="search-field"><Icon name="search" /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setSearch(''); setSearchOpen(false) } }} maxLength={60} onBlur={() => { if (!search) setSearchOpen(false) }} placeholder="搜索" aria-label="搜索词典" /><button aria-label="关闭搜索" onClick={() => { setSearch(''); setSearchOpen(false) }}><Icon name="close" size={12} /></button></label> : <button className="icon-button" aria-label="搜索词典" onClick={() => setSearchOpen(true)}><Icon name="search" /></button>}</div>}
    {error && <p role="alert" className="inline-error">{error} <button className="text-button" onClick={() => void load()}>重试</button></p>}
    {loading ? <div className="hub-loading" role="status" aria-label="正在加载" /> : visible.length === 0 ? <div className="empty-state">{!search && <h2>还没有词汇</h2>}<p>{search ? '未找到与您的搜索匹配的单词。' : (filter === 'auto' ? 'Offkey会自动学习您独特的名称和词汇，并将其添加到您的个人词典中。' : filter === 'manual' ? '您可以手动将独特的名称和词汇添加到您的个人词典中。' : 'Offkey会记住您独特的名称和词汇，这些都是通过您的编辑自动学习或您手动添加的。')}</p></div> : <div className={`dictionary-list ${multiSelect ? 'is-selecting' : ''}`}>{visible.map((entry) => <div className={`dictionary-word ${selected.has(entry.id) ? 'is-selected' : ''} ${menu === entry.id ? 'is-menu-open' : ''}`} key={entry.id}><span className="dictionary-source" title={entry.source === 'auto' ? '由Offkey自动添加' : '手动添加'}>{entry.source === 'auto' ? <Icon name="sparkle" size={12} className="auto-word" /> : <DictionaryGlyph name="manual" />}</span><span className="dictionary-word-name" title={entry.word}>{entry.word}</span><div className="dictionary-word-actions">{!multiSelect && <button className="icon-button dictionary-more" aria-label={`编辑和删除 ${entry.word}`} title="编辑和删除" aria-haspopup="menu" aria-expanded={menu === entry.id} onClick={() => setMenu(menu === entry.id ? null : entry.id)}><Icon name="more" /></button>}<button className="icon-button dictionary-select-word" aria-label={`选择 ${entry.word}`} aria-pressed={selected.has(entry.id)} onClick={() => toggle(entry.id)}><DictionaryGlyph name={selected.has(entry.id) ? 'checked' : 'unchecked'} /></button></div>{menu === entry.id && <HubMenu width={112} onClose={() => setMenu(null)}><button role="menuitem" onClick={() => { setEditing(entry); setDraft(entry.word); setMenu(null) }}>编辑</button><hr /><button role="menuitem" className="danger" onClick={() => { setDeleting([entry]); setMenu(null) }}><Icon name="trash" size={14} />删除</button></HubMenu>}</div>)}</div>}
    {newWord && <div className="dictionary-modal dictionary-add-modal"><Modal title="添加到词典" onClose={closeAdd}>{preview ? <><p className="dictionary-preview-count">{preview.entries.length} 个有效单词在 {preview.fileName} 中找到</p><div className="dictionary-preview-list">{preview.entries.map((entry) => <span key={entry.word} title={entry.word}>{entry.word}</span>)}</div><footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={closeAdd}>取消</button><button className="primary-button" disabled={busy || !preview.entries.length} onClick={() => void importPreview()}>{busy ? '正在添加…' : '添加单词'}</button></footer></> : <form onSubmit={add}><input id="new-word" aria-label="添加新词" className="text-input" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} placeholder="添加新词" maxLength={100} /><footer className="modal-footer"><button type="button" className="dictionary-import" disabled={busy} title="使用一列的 CSV 文件，每行一个单词。" onClick={() => void importCsv()}><Icon name="download" />导入 CSV</button><button type="button" className="secondary-button" disabled={busy} onClick={closeAdd}>取消</button><button className="primary-button" disabled={busy || !draft.trim()}>{busy ? '正在添加…' : '添加词汇'}</button></footer></form>}</Modal></div>}
    {editing && <div className="dictionary-modal dictionary-add-modal"><Modal title="编辑词汇" onClose={() => { if (!busy) setEditing(null) }}><form onSubmit={saveEdit}><input className="text-input" aria-label="编辑词汇" autoFocus value={draft} maxLength={100} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} /><footer className="modal-footer"><button type="button" className="secondary-button" disabled={busy} onClick={() => setEditing(null)}>取消</button><button className="primary-button" disabled={busy || !draft.trim()}>{busy ? '正在保存…' : '保存'}</button></footer></form></Modal></div>}
    {deleting.length > 0 && <ConfirmDialog title={multiSelect ? `删除 ${deleting.length} 个词？` : '删除词汇？'} description={multiSelect ? '所选的词将被永久删除，无法恢复。' : `“${deleting[0].word}”将被永久删除，无法恢复。`} pending={busy} onClose={() => { setDeleting([]); }} onConfirm={() => void remove()} />}
  </div>
}
