import { ENDPOINTS } from '../../shared/constants'
import { IPC } from '../../shared/ipc'
import { broadcast } from '../windows'
import { settings } from '../lib/settings'
import { getAccessToken } from '../services/auth'
import * as history from '../services/history'
import { createLogger } from '../lib/logger'
import type { Handler } from './index'
import type { SyncState } from '../../shared/types'

const log = createLogger('sync')

let state: SyncState = { phase: 'idle', lastSyncedAt: null, pending: 0, error: null }
let timer: NodeJS.Timeout | null = null
let running = false

function publish(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  broadcast(IPC.SYNC_STATE_CHANGED, state)
}

function parseModeMeta(value: string | Buffer): string {
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value)
}

export async function runSyncPass(): Promise<void> {
  if (running) return
  const token = getAccessToken()
  if (!token) return
  running = true
  try {
    publish({ phase: 'pulling', error: null })
    const userId = 'local'
    const candidates = history.pushCandidates(userId)
    publish({ pending: candidates.length })

    if (candidates.length) {
      publish({ phase: 'pushing' })
      for (const record of candidates) {
        try {
          const response = await fetch(`${ENDPOINTS.api}/transcription_history/push`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({
              id: record.id,
              refined_text: record.refinedText,
              mode: record.mode,
              duration: record.duration,
              created_at: record.createdAt,
              mode_meta: record.modeMeta ? JSON.parse(parseModeMeta(record.modeMeta)) : null
            })
          })
          if (!response.ok) throw new Error(`push failed: ${response.status}`)
          history.markSynced(record.id)
        } catch (err) {
          log.warn(`sync push failed for ${record.id}`, err)
          history.markSyncFailed(record.id)
        }
      }
      broadcast(IPC.SYNC_CHANNEL_PULL_DONE)
    }

    publish({ phase: 'idle', lastSyncedAt: Date.now(), pending: 0 })
  } catch (err: any) {
    publish({ phase: 'error', error: err?.message ?? 'sync failed' })
    broadcast(IPC.SYNC_ERROR, err?.message ?? 'sync failed')
  } finally {
    running = false
  }
}

export function startSyncSchedule(): void {
  stopSyncSchedule()
  const interval = settings.get().syncIntervalMs
  if (!settings.get().syncEnabled || interval <= 0) return
  timer = setInterval(() => {
    void runSyncPass()
  }, interval)
}

export function stopSyncSchedule(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export function registerSyncHandlers(handle: (c: string, f: Handler) => void): void {
  handle('sync:trigger', async () => {
    await runSyncPass()
    return state
  })
  handle('sync:state', () => state)
}
