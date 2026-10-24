import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { paths } from '../lib/paths'
import { createLogger } from '../lib/logger'
import * as schema from './schema'

const log = createLogger('db')

export type Db = BetterSQLite3Database<typeof schema>

let sqlite: Database.Database | null = null
let db: Db | null = null

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    // dev: out/main/db -> resources/db
    join(here, '..', '..', '..', 'resources', 'db'),
    // dev, when the main bundle is flat: out/main -> resources/db
    join(here, '..', '..', 'resources', 'db'),
    // packaged: Resources/db
    join(process.resourcesPath ?? here, 'db')
  ]
  for (const candidate of candidates) {
    try {
      if (readdirSync(candidate).some((f) => f.endsWith('.sql'))) return candidate
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(`no migrations directory found (looked in ${candidates.join(', ')})`)
}

/**
 * Applies every `NNNN_*.sql` file in lexical order, recording applied files in
 * `_migrations` so restarts are idempotent.
 */
function migrate(handle: Database.Database): void {
  handle.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL
  )`)
  const applied = new Set(
    handle.prepare('SELECT name FROM _migrations').all().map((r: any) => r.name as string)
  )
  const dir = migrationsDir()
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(dir, file), 'utf8')
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
    const tx = handle.transaction(() => {
      for (const stmt of statements) handle.exec(stmt)
      handle
        .prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)')
        .run(file, new Date().toISOString())
    })
    tx()
    log.info(`migration applied: ${file}`)
  }
}

export function getDb(): Db {
  if (db) return db
  const file = paths.db
  sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('foreign_keys = ON')
  migrate(sqlite)
  db = drizzle(sqlite, { schema })
  log.info(`database ready at ${file}`)
  return db
}

export function getRawDb(): Database.Database {
  getDb()
  return sqlite!
}

export function closeDb(): void {
  sqlite?.close()
  sqlite = null
  db = null
}

export { schema }
