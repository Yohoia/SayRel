import { desc, eq, like } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { parse } from 'csv-parse/sync'
import { getDb, schema } from '../db'
import { broadcast } from '../windows'
import { IPC } from '../../shared/ipc'
import type { DictionaryEntry } from '../../shared/types'

const table = schema.dictionary

export function listDictionary(): DictionaryEntry[] {
  const db = getDb()
  return db.select().from(table).orderBy(desc(table.createdAt)).all() as DictionaryEntry[]
}

export function addWord(input: {
  word: string
  source?: 'manual' | 'auto' | 'csv'
  language?: string | null
}): DictionaryEntry {
  const db = getDb()
  const word = input.word.trim()
  if (!word) throw new Error('word is required')
  if (word.length > 100) throw new Error('word exceeds 100 characters')
  const existing = db
    .select()
    .from(table)
    .where(eq(table.word, word))
    .get()
  if (existing) return existing as DictionaryEntry

  const now = new Date().toISOString()
  const entry: DictionaryEntry = {
    id: randomUUID(),
    word,
    source: input.source ?? 'manual',
    language: input.language ?? null,
    createdAt: now
  }
  db.insert(table)
    .values({ ...entry, updatedAt: now })
    .run()

  if (entry.source === 'auto') {
    broadcast(IPC.DICTIONARY_WORD_AUTO_ADDED, entry)
  }
  return entry
}

/** Editing keeps the original identity, source and creation date. */
export function updateWord(id: string, value: string): DictionaryEntry {
  const word = String(value ?? '').trim()
  if (!word || word.length > 100) throw new Error("Enter 1 to 100 characters.")
  const db = getDb()
  const existing = db.select().from(table).where(eq(table.id, id)).get()
  if (!existing) throw new Error("This word no longer exists. Refresh and try again.")
  const duplicate = listDictionary().find((entry) => entry.id !== id && entry.word.toLocaleLowerCase() === word.toLocaleLowerCase())
  if (duplicate) throw new Error("This word is already in your dictionary.")
  db.update(table).set({ word, updatedAt: new Date().toISOString() }).where(eq(table.id, id)).run()
  return { ...existing, word } as DictionaryEntry
}

export function removeWord(id: string): boolean {
  getDb().delete(table).where(eq(table.id, id)).run()
  return true
}

export function searchDictionary(query: string, limit = 20): DictionaryEntry[] {
  return getDb()
    .select()
    .from(table)
    .where(like(table.word, `%${query}%`))
    .limit(limit)
    .all() as DictionaryEntry[]
}

/** Parses a CSV with `word[,language]` rows; used by the import dialog. */
export function parseDictionaryCsv(content: string): Array<{ word: string; language: string | null }> {
  const rows: Array<{ word: string; language: string | null }> = []
  const records = parse(content, { bom: true, skip_empty_lines: true, trim: true, relax_column_count: true, comment: '#' }) as string[][]
  for (const [first, language] of records) {
    if (!first || /^word$/i.test(first)) continue
    rows.push({ word: first, language: language || null })
  }
  return rows
}
