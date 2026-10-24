import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { asrOutcomeSchema, type AsrFinal } from '../../shared/asr'
import { desktopApps, parseDesktopIntent, type DesktopAction, type DesktopPlanView } from '../../shared/desktopCommands'
import type { AudioContextSnapshot } from '../../shared/types'
import { settings } from '../lib/settings'
import { createLogger } from '../lib/logger'
import * as history from './history'

const log = createLogger('desktop-commands')
type Plan = { view: DesktopPlanView; asr: AsrFinal; action: DesktopAction; context: AudioContextSnapshot | null; historyId: string | null }
let pending: Plan | null = null
let running: { id: string; controller: AbortController } | null = null

function audit(plan: Plan, status: string): void {
  log.info('desktop command', { sessionId: plan.asr.sessionId, requestId: plan.asr.requestId, planId: plan.view.id, action: plan.action.kind, status })
  if (!plan.historyId || !settings.get().historyEnabled) return
  const row = history.getHistory(plan.historyId)
  if (!row?.modeMeta) return
  try {
    const meta = z.record(z.string(), z.unknown()).parse(JSON.parse(row.modeMeta))
    const previous = z.object({ events: z.array(z.object({ status: z.string(), at: z.number() })).optional() }).passthrough().safeParse(meta.desktopCommand)
    const events = [...(previous.success ? previous.data.events ?? [] : []), { status, at: Date.now() }].slice(-10)
    history.upsertHistory({ id: plan.historyId, modeMeta: JSON.stringify({ ...meta,
      desktopCommand: { planId: plan.view.id, sourceAsrRequestId: plan.asr.requestId, action: plan.action, status, events, updatedAt: Date.now() } }) })
  } catch { /* Retain existing history if its metadata cannot be read. */ }
}

export function cancelDesktopPlan(): void {
  if (pending) audit(pending, 'cancelled')
  pending = null
  running?.controller.abort(); running = null
}

export function prepareDesktopPlan(asr: AsrFinal, context: AudioContextSnapshot | null, historyId: string | null): { answer: string; plan?: DesktopPlanView } {
  cancelDesktopPlan()
  const final = asrOutcomeSchema.parse(asr)
  if (!settings.get().desktopCommandsEnabled || final.kind !== 'final' || final.path === 'saved') throw new Error('A new, complete transcription is required for desktop commands')
  const action = parseDesktopIntent(final.asrText)
  if (!action) return { answer: 'Supported commands: Open Safari, Open Finder, Open Notes, Open Calendar, Open Calculator, Read selected text, or What is the current app? Please request one action at a time.' }
  if (action.kind === 'open_app' && process.platform !== 'darwin') return { answer: 'Opening supported apps is currently available on macOS.' }
  if (action.kind !== 'open_app' && (!context?.focusedApp || context.focusedInput?.isSecure)) return { answer: 'No readable app context was captured. Enable focused-app context and try again from the target app.' }
  const summary = action.kind === 'open_app' ? `Open ${desktopApps[action.app].label}`
    : action.kind === 'read_selection' ? 'Show the text selected when this recording started' : 'Show the app focused when this recording started'
  const view = { id: randomUUID(), summary, expiresAt: Date.now() + 120_000 }
  pending = { view, asr: final, action, context, historyId }
  return { answer: summary, plan: view }
}

export async function approveDesktopPlan(rawId: unknown): Promise<string> {
  const id = z.string().uuid().parse(rawId), plan = pending
  if (!plan || id !== plan.view.id || Date.now() > plan.view.expiresAt || !settings.get().desktopCommandsEnabled) throw new Error('This command has expired or was cancelled. Record a new command.')
  pending = null
  const execution = { id, controller: new AbortController() }
  running = execution
  audit(plan, 'approved')
  try {
    let answer: string
    switch (plan.action.kind) {
      case 'open_app':
        await promisify(execFile)('/usr/bin/open', ['-b', desktopApps[plan.action.app].bundleId], { signal: execution.controller.signal, timeout: 10_000 })
        answer = `Opened ${desktopApps[plan.action.app].label}`
        break
      case 'read_selection': answer = plan.context?.focusedInput?.selectedText?.slice(0, 1000) || 'No text was selected when recording started.'; break
      case 'read_focused_app': answer = plan.context?.focusedApp?.appName ?? 'The focused app was unavailable.'; break
      default: { const exhaustive: never = plan.action; throw new Error(`Unsupported action: ${exhaustive}`) }
    }
    if (execution.controller.signal.aborted) throw new Error('Command cancelled')
    audit(plan, 'completed')
    return answer
  } catch (error) { audit(plan, execution.controller.signal.aborted ? 'cancelled' : 'failed'); throw error }
  finally { if (running === execution) running = null }
}
