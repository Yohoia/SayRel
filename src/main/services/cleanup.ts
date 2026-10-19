import schedule from 'node-schedule'
import { settings } from '../lib/settings'
import * as history from './history'
import { createLogger } from '../lib/logger'

const log = createLogger('cleanup')

let jobs: schedule.Job[] = []

/** Nightly retention: history rows first, then orphaned audio files. */
export function startCleanupSchedule(): void {
  stopCleanupSchedule()
  jobs.push(
    schedule.scheduleJob('0 3 * * *', () => {
      const config = settings.get()
      try {
        if (config.historyRetentionDays > 0) {
          const removed = history.deleteByDuration(config.historyRetentionDays * 86_400_000)
          log.info(`history retention removed ${removed} rows`)
        }
        if (config.audioRetentionDays > 0) {
          const removed = history.deleteByDuration(config.audioRetentionDays * 86_400_000)
          log.info(`audio retention removed ${removed} rows`)
        }
      } catch (err) {
        log.error('cleanup job failed', err)
      }
    })
  )
  jobs.push(
    schedule.scheduleJob('*/30 * * * *', () => {
      try {
        history.deleteByDuration(Math.max(0, 0))
        const usage = history.diskUsage()
        if (usage.bytes > 2 * 1024 * 1024 * 1024) {
          log.warn(`recordings exceed 2GB (${usage.bytes} bytes)`)
        }
      } catch (err) {
        log.error('disk check failed', err)
      }
    })
  )
}

export function stopCleanupSchedule(): void {
  for (const job of jobs) job.cancel()
  jobs = []
}
