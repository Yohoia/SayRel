import { app, dialog } from 'electron'
import { copyFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { recordingMachine } from '../services/recordingMachine'
import * as history from '../services/history'
import { settings } from '../lib/settings'
import { paths } from '../lib/paths'
import type { Handler } from './index'
import { readVoiceMetadata } from '../../shared/refinement'
import { z } from 'zod'

export function registerHistoryHandlers(handle: (c: string, f: Handler) => void): void {
  handle('db:get-device-id', () => settings.deviceId)

  handle('db:history-get', (_e, id: string) => history.getHistory(id))
  handle('db:history-latest', (_e, limit?: number) => history.getLatest(limit ?? 1))
  handle('db:history-latest-id', () => history.getLatestId())
  handle('db:history-latest-id-for-error-tracking', () => history.getLatestId())
  handle('db:history-list', (_e, query?: unknown) => history.listHistory((query ?? {}) as any))
  handle('db:history-activity', () => history.getHistoryActivity())
  handle('db:history-usage', () => history.getDictationUsage())
  handle('db:history-retry', async (_e, id: string) => {
    await recordingMachine.retryHistory(id)
    const row = history.getHistory(id)
    return row ? { ...row, refinement: readVoiceMetadata(row.modeMeta?.toString() ?? null)?.refinement } : null
  })
  handle('db:history-refine', async (_e, rawId: unknown) => {
    const id = z.string().min(1).max(200).parse(rawId)
    await recordingMachine.retryHistory(id, 'refine')
    const row = history.getHistory(id)
    return row ? { ...row, refinement: readVoiceMetadata(row.modeMeta?.toString() ?? null)?.refinement } : null
  })
  handle('db:history-export-audio', async (_e, id: string) => {
    const record = history.getHistory(id)
    if (!record?.audioLocalPath) throw new Error("No audio was saved for this recording.")
    await stat(record.audioLocalPath)
    const extension = extname(record.audioLocalPath).slice(1) || 'ogg'
    const result = await dialog.showSaveDialog({
      defaultPath: join(app.getPath('downloads'), `Sayrel-${(record.createdAt ?? id).replace(/[:/]/g, '-')}.${extension}`),
      filters: [{ name: "Audio", extensions: [extension] }]
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    await copyFile(record.audioLocalPath, result.filePath)
    return { canceled: false, path: result.filePath }
  })
  handle('db:history-upsert', (_e, payload: any) => history.upsertHistory(payload))
  handle('db:history-delete', (_e, id: string) => history.deleteHistory(id))
  handle('db:history-clear', (_e, opts?: unknown) => history.clearHistory((opts ?? {}) as any))
  handle('db:history-delete-by-duration', (_e, ms: number) => history.deleteByDuration(ms))

  handle('db:history-upsert-client-metadata', (_e, id: string, meta: object) => {
    history.upsertClientMetadata(id, meta ?? {})
    return true
  })
  handle('db:history-upsert-mode-meta', (_e, id: string, meta: object) => {
    history.upsertModeMeta(id, meta ?? {})
    return true
  })
  handle('db:history-save-audio', (_e, id: string, data: ArrayBuffer) => {
    return history.saveAudio(id, Buffer.from(new Uint8Array(data)))
  })
  handle('db:history-v2-migration-start', () => history.migrateFromV1())

  handle('db:history-trigger-disk-cleanup', async () => {
    const config = settings.get()
    const freed = history.diskUsage()
    if (config.audioRetentionDays > 0) {
      await history.deleteAudioByDuration(config.audioRetentionDays * 24 * 60 * 60 * 1000)
    }
    return { before: freed, after: history.diskUsage() }
  })

  handle('db:history-trigger-history-cleanup', () => {
    const days = settings.get().historyRetentionDays
    if (days <= 0) return 0
    return history.deleteByDuration(days * 24 * 60 * 60 * 1000)
  })

  handle('file:read-recordings-size', () => history.diskUsage())
  handle('file:open-recordings', async () => {
    const { shell } = await import('electron')
    await shell.openPath(paths.recordings)
    return true
  })
}
