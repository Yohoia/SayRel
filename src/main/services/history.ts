import { and, count, desc, eq, gte, inArray, isNotNull, like, lt, ne, or, sql } from 'drizzle-orm'
import { unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { getDb, getRawDb, schema } from '../db'
import { createLogger } from '../lib/logger'
import { paths } from '../lib/paths'
import { HISTORY_STATUS } from '../../shared/constants'
import { buildDictationUsage } from '../../shared/usage'
import { readVoiceMetadata } from '../../shared/refinement'
import type {
  HistoryListQuery,
  HistoryListResult,
  HistoryListItem,
  HistoryRecord
} from '../../shared/types'
import { join } from 'node:path'

const log = createLogger('history')
const table = schema.historyV2

export interface UpsertHistoryInput {
  id: string
  status?: string | null
  mode?: string
  refinedText?: string | null
  duration?: number | null
  audioLocalPath?: string | null
  audioMetadata?: string | null
  micDevice?: string | null
  micDeviceInfo?: Buffer | null
  clientMetadata?: Buffer | null
  modeMeta?: string | Buffer | null
  debugInfo?: string | null
  audioContext?: string | null
  appVersion?: string
}

export function upsertHistory(input: UpsertHistoryInput): HistoryRecord {
  const db = getDb()
  const now = new Date().toISOString()
  const modeMeta =
    input.modeMeta == null
      ? null
      : Buffer.isBuffer(input.modeMeta)
        ? input.modeMeta
        : Buffer.from(input.modeMeta, 'utf8')

  const existing = db.select().from(table).where(eq(table.id, input.id)).get()
  if (existing) {
    db.update(table)
      .set({
        status: input.status ?? existing.status,
        refinedText: input.refinedText ?? existing.refinedText,
        duration: input.duration ?? existing.duration,
        audioLocalPath: input.audioLocalPath ?? existing.audioLocalPath,
        audioMetadata: input.audioMetadata ?? existing.audioMetadata,
        micDevice: input.micDevice ?? existing.micDevice,
        micDeviceInfo: input.micDeviceInfo ?? existing.micDeviceInfo,
        clientMetadata: input.clientMetadata ?? existing.clientMetadata,
        modeMeta: modeMeta ?? existing.modeMeta,
        debugInfo: input.debugInfo ?? existing.debugInfo,
        audioContext: input.audioContext ?? existing.audioContext,
        updatedAt: now
      })
      .where(eq(table.id, input.id))
      .run()
  } else {
    db.insert(table)
      .values({
        id: input.id,
        status: input.status ?? HISTORY_STATUS.PROCESSING,
        mode: input.mode ?? 'voice_transcript',
        refinedText: input.refinedText ?? null,
        duration: input.duration ?? null,
        createdAt: now,
        updatedAt: now,
        audioLocalPath: input.audioLocalPath ?? null,
        audioMetadata: input.audioMetadata ?? null,
        appVersion: input.appVersion ?? '0.0.0',
        micDevice: input.micDevice ?? null,
        micDeviceInfo: input.micDeviceInfo ?? null,
        clientMetadata: input.clientMetadata ?? null,
        modeMeta,
        debugInfo: input.debugInfo ?? null,
        audioContext: input.audioContext ?? null
      })
      .run()
  }
  return getHistory(input.id)!
}

export function getHistory(id: string): HistoryRecord | null {
  const row = getDb().select().from(table).where(eq(table.id, id)).get()
  return (row as HistoryRecord | undefined) ?? null
}

export function getLatest(limit = 1): HistoryRecord[] {
  return getDb().select().from(table).orderBy(desc(table.createdAt)).limit(limit).all() as HistoryRecord[]
}

export function getLatestId(): string | null {
  const row = getDb()
    .select({ id: table.id })
    .from(table)
    .orderBy(desc(table.createdAt))
    .limit(1)
    .get()
  return row?.id ?? null
}

function toListItem(row: any): HistoryListItem {
  const metadata = readVoiceMetadata(row.modeMeta?.toString() ?? null)
  let focusedAppName: string | null = null
  let focusedAppBundleId: string | null = null
  let detectedLanguage: string | null = null
  if (row.audioContext) {
    try {
      const ctx = JSON.parse(row.audioContext)
      focusedAppName = ctx?.focusedApp?.appName ?? null
      focusedAppBundleId = ctx?.focusedApp?.bundleId ?? null
      detectedLanguage = ctx?.detectedLanguage ?? null
    } catch {
      /* malformed context is not fatal */
    }
  }
  if (row.clientMetadata) {
    try {
      const meta = JSON.parse(row.clientMetadata.toString('utf8'))
      focusedAppName = focusedAppName ?? meta?.focusedAppName ?? null
      focusedAppBundleId = focusedAppBundleId ?? meta?.focusedAppBundleId ?? null
    } catch {
      /* ignore */
    }
  }
  return {
    id: row.id,
    refinedText: row.refinedText,
    status: row.status,
    mode: row.mode ?? 'voice_transcript',
    duration: row.duration,
    createdAt: row.createdAt,
    focusedAppName,
    focusedAppBundleId,
    detectedLanguage: metadata?.detectedLanguage ?? detectedLanguage,
    ...(metadata?.refinement ? { refinement: metadata.refinement } : {}),
    audioLocalPath: row.audioLocalPath,
    hasAudio: Boolean(row.audioLocalPath && existsSync(row.audioLocalPath))
  }
}

export function listHistory(query: HistoryListQuery = {}): HistoryListResult {
  const db = getDb()
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 500)
  const offset = Math.max(query.offset ?? 0, 0)
  const clauses: any[] = []
  if (query.status) clauses.push(eq(table.status, query.status))
  if (query.mode === 'dictations') clauses.push(ne(table.mode, 'ask_anything'))
  else if (query.mode) clauses.push(eq(table.mode, query.mode))
  if (query.from) clauses.push(gte(table.createdAt, query.from))
  if (query.to) clauses.push(lt(table.createdAt, query.to))
  if (query.search) {
    clauses.push(
      or(like(table.refinedText, `%${query.search}%`), like(table.id, `%${query.search}%`))!
    )
  }
  const where = clauses.length ? and(...clauses) : undefined

  const rows = db
    .select()
    .from(table)
    .where(where)
    .orderBy(desc(table.createdAt), desc(table.id))
    .limit(limit)
    .offset(offset)
    .all()

  const totalRow = db.select({ value: count() }).from(table).where(where).get()
  const total = (totalRow?.value as number) ?? 0
  const last = rows[rows.length - 1]
  return {
    items: rows.map(toListItem),
    total,
    nextCursor: rows.length === limit && last ? last.createdAt : null
  }
}

export function getHistoryActivity() {
  const date = sql<string>`date(${table.createdAt}, 'localtime')`
  const days = getDb().select({ date, count: count() }).from(table)
    .where(and(eq(table.status, HISTORY_STATUS.COMPLETED), lt(table.createdAt, new Date().toISOString()), isNotNull(date)))
    .groupBy(date).orderBy(date).all()
  return { days }
}

export function getDictationUsage() {
  const records = getDb().select({ refinedText: table.refinedText, duration: table.duration }).from(table)
    .where(and(eq(table.status, HISTORY_STATUS.COMPLETED), sql`coalesce(${table.mode}, 'voice_transcript') != 'ask_anything'`,
      lt(table.createdAt, new Date().toISOString()), sql`datetime(${table.createdAt}) is not null`)).all()
  return buildDictationUsage(records)
}

export function deleteHistory(id: string): boolean {
  const db = getDb()
  const row = getHistory(id)
  if (!row) return false
  db.delete(table).where(eq(table.id, id)).run()
  if (row.audioLocalPath) {
    unlink(row.audioLocalPath).catch(() => {
      /* already gone */
    })
  }
  return true
}

export function clearHistory(opts: { keepAudioFiles?: boolean } = {}): number {
  const db = getDb()
  const rows = db.select({ id: table.id, audioLocalPath: table.audioLocalPath }).from(table).all()
  db.delete(table).run()
  if (!opts.keepAudioFiles) {
    for (const row of rows) {
      if (row.audioLocalPath) unlink(row.audioLocalPath).catch(() => {})
    }
  }
  return rows.length
}

export function deleteByDuration(minAgeMs: number): number {
  const cutoff = new Date(Date.now() - minAgeMs).toISOString()
  const db = getDb()
  const rows = db
    .select({ id: table.id, audioLocalPath: table.audioLocalPath })
    .from(table)
    .where(lt(table.createdAt, cutoff))
    .all()
  if (!rows.length) return 0
  db.delete(table)
    .where(inArray(table.id, rows.map((r) => r.id)))
    .run()
  for (const row of rows) {
    if (row.audioLocalPath) unlink(row.audioLocalPath).catch(() => {})
  }
  return rows.length
}

export async function deleteAudioByDuration(minAgeMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - minAgeMs).toISOString()
  const db = getDb()
  const rows = db.select({ id: table.id, audioLocalPath: table.audioLocalPath }).from(table)
    .where(and(lt(table.createdAt, cutoff), isNotNull(table.audioLocalPath))).all()
  let removed = 0
  for (const row of rows) {
    if (!row.audioLocalPath) continue
    try {
      await unlink(row.audioLocalPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
      db.update(table).set({ audioLocalPath: null })
        .where(and(eq(table.id, row.id), eq(table.audioLocalPath, row.audioLocalPath))).run()
      removed++
    } catch (error) {
      log.warn('audio retention could not remove file', { id: row.id, error })
    }
  }
  return removed
}

export function upsertClientMetadata(id: string, metadata: object): void {
  getDb()
    .update(table)
    .set({ clientMetadata: Buffer.from(JSON.stringify(metadata), 'utf8') })
    .where(eq(table.id, id))
    .run()
}

export function upsertModeMeta(id: string, meta: object): void {
  getDb()
    .update(table)
    .set({ modeMeta: Buffer.from(JSON.stringify(meta), 'utf8') })
    .where(eq(table.id, id))
    .run()
}

export function saveAudio(id: string, audio: Buffer): string {
  const file = join(paths.recordings, `${id}.ogg`)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { writeFileSync } = require('node:fs')
  writeFileSync(file, audio)
  getDb().update(table).set({ audioLocalPath: file }).where(eq(table.id, id)).run()
  return file
}

export function diskUsage(): { bytes: number; files: number } {
  const db = getRawDb()
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(LENGTH(refined_text)), 0) + COALESCE(SUM(LENGTH(audio_context)), 0) AS bytes, COUNT(*) AS files FROM history_v2`
    )
    .get() as { bytes: number; files: number }
  let audioBytes = 0
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { statSync, readdirSync } = require('node:fs')
    for (const f of readdirSync(paths.recordings)) {
      try {
        audioBytes += statSync(join(paths.recordings, f)).size
      } catch {
        /* race with cleanup */
      }
    }
  } catch {
    /* no recordings dir yet */
  }
  return { bytes: (row?.bytes ?? 0) + audioBytes, files: row?.files ?? 0 }
}

/** One-time migration from the v1 table, preserving recording ids. */
export function migrateFromV1(): number {
  const db = getDb()
  // The legacy table only exists on installs upgraded from the v1 schema.
  const exists = getRawDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='history'")
    .get()
  if (!exists) return 0
  const legacy = db.select().from(schema.history).all()
  if (!legacy.length) return 0
  let migrated = 0
  for (const row of legacy) {
    const exists = db.select({ id: table.id }).from(table).where(eq(table.id, row.id)).get()
    if (exists) continue
    db.insert(table)
      .values({
        id: row.id,
        status: row.status ?? HISTORY_STATUS.COMPLETED,
        mode: row.mode ?? 'voice_transcript',
        refinedText: row.refinedText ?? null,
        duration: row.duration ?? null,
        createdAt: row.createdAt ?? new Date().toISOString(),
        updatedAt: row.updatedAt ?? new Date().toISOString(),
        audioLocalPath: row.audioLocalPath ?? null,
        audioMetadata: row.audioMetadata ?? null,
        appVersion: row.appVersion ?? '0.0.0',
        micDevice: row.micDevice ?? null,
        micDeviceInfo: row.micDeviceInfo ?? null,
        clientMetadata: row.clientMetadata ?? null,
        modeMeta: row.modeMeta ? Buffer.from(row.modeMeta, 'utf8') : null,
        debugInfo: row.debugInfo ?? null,
        audioContext: row.audioContext ?? null
      })
      .run()
    migrated++
  }
  if (migrated) log.info(`migrated ${migrated} rows from history -> history_v2`)
  return migrated
}
