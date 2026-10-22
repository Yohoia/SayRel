import { useAppText } from '../../shared/i18n/useAppText'
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
const FILTERS = [{ id: 'all', label: "All" }, { id: 'auto', label: "Auto-added" }, { id: 'manual', label: "Added manually" }]

export function DictionaryPage() {
  const t = useAppText()
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
    catch { setError("Could not load the dictionary. Please try again.") }
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
    try { await api.dictionary.add(draft.trim()); await load(); setNewWord(false); setDraft(''); toast.success("Saved") }
    catch { toast.error("Could not save. Please try again.") }
    finally { setBusy(false) }
  }
  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editing || busy || !draft.trim()) return
    setBusy(true)
    try {
      const updated = await api.dictionary.update(editing.id, draft.trim())
      setEntries((current) => current.map((entry) => entry.id === editing.id ? updated : entry))
      setEditing(null); setDraft(''); toast.success("Saved")
    } catch (error) { toast.error(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : "Could not save. Please try again.") }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!deleting.length || busy) return
    setBusy(true)
    const removed = new Set<string>()
    try {
      for (const entry of deleting) { await api.dictionary.remove(entry.id); removed.add(entry.id) }
      setDeleting([]); toast.success("Deleted")
    } catch { toast.error("Could not delete. Please try again."); setDeleting((current) => current.filter((entry) => !removed.has(entry.id))) }
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
      if (!valid.length) { toast.info("No words found to import"); return }
      setPreview({ entries: valid, fileName: result.fileName ?? "CSV file" })
    } catch { toast.error("Could not read the file") }
    finally { setBusy(false) }
  }
  const importPreview = async () => {
    if (!preview || busy) return
    setBusy(true)
    let imported = 0
    try {
      for (const entry of preview.entries) { await api.dictionary.add(entry.word, { source: 'csv', language: entry.language }); imported++ }
      setPreview(null); setNewWord(false); setDraft(''); toast.success("Imported")
    } catch { setPreview({ ...preview, entries: preview.entries.slice(imported) }); toast.error("Could not import. Please try again.") }
    finally { await load(); setBusy(false) }
  }
  return <div className="page dictionary-page">
    <header className="page-heading"><div className="page-heading-copy"><h1 className="page-title">{t("Dictionary")}</h1></div><div className="page-actions"><button className="primary-button" onClick={() => { setNewWord(true); setDraft(''); setPreview(null) }}><Icon name="plus" />{t("New word")}</button></div></header>
    {multiSelect ? <div className="dictionary-selection"><button className="icon-button" aria-label={allSelected ? t("Clear selection") : t("Select all")} role="checkbox" aria-checked={allSelected ? true : 'mixed'} onClick={() => setSelected(allSelected ? new Set() : new Set(visible.map((entry) => entry.id)))}><DictionaryGlyph name={allSelected ? 'checked' : 'mixed'} /></button><span>{t(`${selected.size} words selected`)}</span><button className="dictionary-selection-delete" onClick={() => { setDeleting(entries.filter((entry) => selected.has(entry.id))) }}><Icon name="trash" size={14} />{t("Delete")}</button></div> : <div className="page-toolbar"><div className="segmented-tabs" role="tablist" aria-label={t("Word source")}>{FILTERS.map((item) => <button key={item.id} role="tab" aria-selected={filter === item.id} onClick={() => setFilter(item.id)}>{item.id === 'auto' && <Icon name="sparkle" size={14} className="auto-word" />}{item.id === 'manual' && <DictionaryGlyph name="manual" />}{t(item.label)}</button>)}</div>{searchOpen ? <label className="search-field"><Icon name="search" /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setSearch(''); setSearchOpen(false) } }} maxLength={60} onBlur={() => { if (!search) setSearchOpen(false) }} placeholder={t("Search")} aria-label={t("Search dictionary")} /><button aria-label={t("Close search")} onClick={() => { setSearch(''); setSearchOpen(false) }}><Icon name="close" size={12} /></button></label> : <button className="icon-button" aria-label={t("Search dictionary")} onClick={() => setSearchOpen(true)}><Icon name="search" /></button>}</div>}
    {error && <p role="alert" className="inline-error">{t(error)} <button className="text-button" onClick={() => void load()}>{t("Retry")}</button></p>}
    {loading ? <div className="hub-loading" role="status" aria-label={t("Loading")} /> : visible.length === 0 ? <div className="empty-state">{!search && <h2>{t("No words yet")}</h2>}<p>{search ? t("No words found matching your search.") : (filter === 'auto' ? t("Sayrel automatically learns your unique names and words from your edits and adds them to your personal dictionary.") : filter === 'manual' ? t("You can manually add your unique names and words to your personal dictionary.") : t("Sayrel remembers your unique names and words, learned automatically from your edits or added manually by you."))}</p></div> : <div className={`dictionary-list ${multiSelect ? 'is-selecting' : ''}`}>{visible.map((entry) => <div className={`dictionary-word ${selected.has(entry.id) ? 'is-selected' : ''} ${menu === entry.id ? 'is-menu-open' : ''}`} key={entry.id}><span className="dictionary-source" title={entry.source === 'auto' ? t("Auto-added by Sayrel") : t("Added manually")}>{entry.source === 'auto' ? <Icon name="sparkle" size={12} className="auto-word" /> : <DictionaryGlyph name="manual" />}</span><span className="dictionary-word-name" title={entry.word}>{entry.word}</span><div className="dictionary-word-actions">{!multiSelect && <button className="icon-button dictionary-more" aria-label={t(`Edit and delete ${entry.word}`)} title={t("Edit and delete")} aria-haspopup="menu" aria-expanded={menu === entry.id} onClick={() => setMenu(menu === entry.id ? null : entry.id)}><Icon name="more" /></button>}<button className="icon-button dictionary-select-word" aria-label={t(`Select ${entry.word}`)} aria-pressed={selected.has(entry.id)} onClick={() => toggle(entry.id)}><DictionaryGlyph name={selected.has(entry.id) ? 'checked' : 'unchecked'} /></button></div>{menu === entry.id && <HubMenu width={112} onClose={() => setMenu(null)}><button role="menuitem" onClick={() => { setEditing(entry); setDraft(entry.word); setMenu(null) }}>{t("Edit")}</button><hr /><button role="menuitem" className="danger" onClick={() => { setDeleting([entry]); setMenu(null) }}><Icon name="trash" size={14} />{t("Delete")}</button></HubMenu>}</div>)}</div>}
    {newWord && <div className="dictionary-modal dictionary-add-modal"><Modal title={t("Add to dictionary")} onClose={closeAdd}>{preview ? <><p className="dictionary-preview-count">{t(`${preview.entries.length} valid words found in ${preview.fileName}`)}</p><div className="dictionary-preview-list">{preview.entries.map((entry) => <span key={entry.word} title={entry.word}>{entry.word}</span>)}</div><footer className="modal-footer"><button className="secondary-button" disabled={busy} onClick={closeAdd}>{t("Cancel")}</button><button className="primary-button" disabled={busy || !preview.entries.length} onClick={() => void importPreview()}>{busy ? t("Adding…") : t("Add words")}</button></footer></> : <form onSubmit={add}><input id="new-word" aria-label={t("Add a new word")} className="text-input" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} placeholder={t("Add a new word")} maxLength={100} /><footer className="modal-footer"><button type="button" className="dictionary-import" disabled={busy} title={t("Use a one-column CSV file with one word per line.")} onClick={() => void importCsv()}><Icon name="download" />{t("Import CSV")}</button><button type="button" className="secondary-button" disabled={busy} onClick={closeAdd}>{t("Cancel")}</button><button className="primary-button" disabled={busy || !draft.trim()}>{busy ? t("Adding…") : t("Add word")}</button></footer></form>}</Modal></div>}
    {editing && <div className="dictionary-modal dictionary-add-modal"><Modal title={t("Edit word")} onClose={() => { if (!busy) setEditing(null) }}><form onSubmit={saveEdit}><input className="text-input" aria-label={t("Edit word")} autoFocus value={draft} maxLength={100} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} /><footer className="modal-footer"><button type="button" className="secondary-button" disabled={busy} onClick={() => setEditing(null)}>{t("Cancel")}</button><button className="primary-button" disabled={busy || !draft.trim()}>{busy ? t("Saving…") : t("Save")}</button></footer></form></Modal></div>}
    {deleting.length > 0 && <ConfirmDialog title={multiSelect ? t(`Delete ${deleting.length} words?`) : t("Delete word?")} description={multiSelect ? t("The words selected will be deleted forever. This can't be undone.") : t(`“${deleting[0].word}” will be permanently deleted. This cannot be undone.`)} pending={busy} onClose={() => { setDeleting([]); }} onConfirm={() => void remove()} />}
  </div>
}
