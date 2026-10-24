import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { inputSnapshotSchema, dictatedRegion, correctedWords, type InputSnapshot, type WordSuggestion } from '../../shared/editLearning'
import { settings } from '../lib/settings'
import { readInputState } from './insertion'
import { addWord, listDictionary, removeWord } from './dictionary'
import { broadcast } from '../windows'
import { keyboard } from '../lib/native'
import * as history from './history'

const suggestions = new Map<string, WordSuggestion>()
const undoable = new Map<string, { word: string; expiresAt: number }>()
const processed = new Set<string>()
let stopTracking: (() => void) | null = null

export function captureLearningSnapshot(): InputSnapshot | null {
  if (!settings.get().dictionaryLearning) return null
  const parsed = inputSnapshotSchema.safeParse(readInputState(100))
  return parsed.success ? parsed.data : null
}

export function trackInsertedDictation(input: { requestId: string; historyId: string | null; before: InputSnapshot; inserted: string; asrText: string }): void {
  stopTracking?.()
  if (!settings.get().dictionaryLearning || processed.has(input.requestId) || input.inserted.length > 1000) return
  let initialInsertionSeen = false, previousEdit = '', stableSince = 0
  let lastSnapshot: InputSnapshot | null = null
  const startedAt = Date.now()
  const cleanup = () => { clearInterval(timer); clearTimeout(initialTimer); offKey(); if (stopTracking === cleanup) stopTracking = null }
  const complete = (edited: string) => {
    processed.add(input.requestId)
    if (processed.size > 100) { const oldest = processed.values().next().value; if (oldest) processed.delete(oldest) }
    cleanup()
    const existing = new Set([...listDictionary().map(entry => entry.word), ...[...suggestions.values()].map(item => item.word)].map(word => word.toLocaleLowerCase()))
    for (const word of correctedWords(input.inserted, edited)) {
      if (existing.has(word.toLocaleLowerCase())) continue
      const suggestion = { id: randomUUID(), requestId: input.requestId, word, createdAt: Date.now() }
      suggestions.set(suggestion.id, suggestion)
      existing.add(word.toLocaleLowerCase())
    }
    if (input.historyId && settings.get().historyEnabled) {
      const row = history.getHistory(input.historyId)
      if (row?.modeMeta) {
        try {
          const meta = z.record(z.string(), z.unknown()).parse(JSON.parse(row.modeMeta))
          history.upsertHistory({ id: input.historyId, modeMeta: JSON.stringify({ ...meta, finalEditedText: edited }) })
        } catch { /* Older history metadata may not have the current JSON shape. */ }
      }
    }
    listWordSuggestions()
    broadcast('dictionary:suggestions-changed')
  }
  const check = (send = false) => {
    if (!settings.get().dictionaryLearning || Date.now() - startedAt > 15_000) { cleanup(); return }
    const snapshot = captureLearningSnapshot()
    if (!snapshot || snapshot.targetId !== input.before.targetId) { cleanup(); return }
    const region = dictatedRegion(input.before, snapshot)
    if (!region) {
      if (send && initialInsertionSeen && lastSnapshot) {
        const lastRegion = dictatedRegion(input.before, lastSnapshot)
        if (lastRegion && lastRegion !== input.inserted.trim()) complete(lastRegion)
      }
      return
    }
    lastSnapshot = snapshot
    if (!initialInsertionSeen) {
      initialInsertionSeen = region === input.inserted.trim()
      return
    }
    if (region === input.inserted.trim()) { previousEdit = ''; return }
    if (previousEdit !== region) { previousEdit = region; stableSince = Date.now() }
    if (send || Date.now() - stableSince >= 1500) complete(region)
  }
  const offKey = keyboard.onKey(event => { if (event.pressed && ['Enter', 'Return'].includes(event.key)) check(true) })
  const timer = setInterval(() => check(), 1000)
  const initialTimer = setTimeout(() => check(), 250)
  timer.unref()
  initialTimer.unref()
  stopTracking = cleanup
}

export function listWordSuggestions(): WordSuggestion[] {
  if (!settings.get().dictionaryLearning) { clearDictionaryLearning(); return [] }
  const now = Date.now()
  for (const [id, value] of undoable) if (value.expiresAt < now) undoable.delete(id)
  for (const [id, value] of suggestions) if (now - value.createdAt > 10 * 60_000) suggestions.delete(id)
  while (suggestions.size > 50) { const first = suggestions.keys().next().value; if (first) suggestions.delete(first) }
  return [...suggestions.values()]
}

export function acceptWordSuggestion(rawId: unknown) {
  const id = z.string().uuid().parse(rawId)
  const suggestion = listWordSuggestions().find(item => item.id === id)
  if (!suggestion) throw new Error('This word suggestion has expired')
  const existing = listDictionary().find(entry => entry.word.toLocaleLowerCase() === suggestion.word.toLocaleLowerCase())
  const entry = existing ?? addWord({ word: suggestion.word, source: 'auto' })
  suggestions.delete(id)
  if (!existing) undoable.set(entry.id, { word: entry.word, expiresAt: Date.now() + 5000 })
  broadcast('dictionary:suggestions-changed')
  return { entry, canUndo: !existing }
}

export function dismissWordSuggestion(rawId: unknown): void {
  suggestions.delete(z.string().uuid().parse(rawId)); broadcast('dictionary:suggestions-changed')
}

export function undoLearnedWord(rawId: unknown): void {
  const id = z.string().uuid().parse(rawId), pending = undoable.get(id)
  undoable.delete(id)
  if (!pending || pending.expiresAt < Date.now()) throw new Error('The undo window has expired')
  const entry = listDictionary().find(item => item.id === id)
  if (entry?.source === 'auto' && entry.word === pending.word) removeWord(id)
  broadcast('dictionary:suggestions-changed')
}

export function clearDictionaryLearning(): void {
  stopTracking?.(); suggestions.clear(); undoable.clear()
}

export function stopDictionaryTracking(): void { stopTracking?.() }
