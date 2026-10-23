import { onboardingWindow, openHub } from '../windows'
import { BrowserWindow, globalShortcut, shell, webContents, type WebContents } from 'electron'
import { practiceTargetSchema, type PracticeResult } from '../../shared/featureTour'
import { join } from 'node:path'
import { settings } from '../lib/settings'
import { keyboard, util, input, context } from '../lib/native'
import { insertText } from '../services/insertion'
import { recordingMachine } from '../services/recordingMachine'
import { shortcutBindings } from '../services/hotkeys'
import { refreshShortcutRegistrations } from '../services/shortcutRegistration'
import { listDictionary, addWord, updateWord, removeWord } from '../services/dictionary'
import { createLogger } from '../lib/logger'
import type { Handler } from './index'

const log = createLogger('ipc:misc')

export function registerMiscHandlers(handle: (c: string, f: Handler) => void): void {
  const practiceOwners = new Set<number>()
  const trackPracticeOwner = (sender: WebContents) => {
    const ownerId = sender.id
    if (practiceOwners.has(ownerId)) return
    practiceOwners.add(ownerId)
    const cleanup = () => {
      recordingMachine.setPracticeTarget(ownerId, null)
      practiceOwners.delete(ownerId)
      sender.removeListener('destroyed', cleanup)
      sender.removeListener('render-process-gone', cleanup)
    }
    sender.once('destroyed', cleanup)
    sender.once('render-process-gone', cleanup)
  }
  handle('feature-tour:set-target', (event, raw: unknown) => {
    const target = raw === null ? null : practiceTargetSchema.parse(raw)
    const ownerId = event.sender.id
    recordingMachine.setPracticeTarget(ownerId, target)
    if (target) trackPracticeOwner(event.sender)
    return true
  })
  handle('feature-tour:start', event => recordingMachine.startPractice(event.sender.id))
  handle('feature-tour:block', event => { recordingMachine.blockPractice(event.sender.id); trackPracticeOwner(event.sender); return true })
  handle('feature-tour:finish', event => recordingMachine.finishPractice(event.sender.id))
  handle('page:set-hub-window-button-visibility', (event, visible: unknown) => {
    if (typeof visible !== 'boolean') return false
    if (process.platform === 'darwin') BrowserWindow.fromWebContents(event.sender)?.setWindowButtonVisibility(visible)
    return true
  })
  recordingMachine.on('practice-result', ({ ownerId, ...result }: PracticeResult & { ownerId: number }) => {
    webContents.fromId(ownerId)?.send('feature-tour:result', result)
  })
  handle('page:close-onboarding', () => {
    onboardingWindow.closeWindow()
    openHub('main')
    return true
  })
  // ---- dictionary --------------------------------------------------------
  handle('dictionary:list', () => listDictionary())
  handle('dictionary:add', (_e, word: string, opts?: any) =>
    addWord({ word, source: opts?.source ?? 'manual', language: opts?.language ?? null })
  )
  handle('dictionary:update', (_e, id: string, word: string) => updateWord(id, word))
  handle('dictionary:remove', (_e, id: string) => removeWord(id))

  // ---- keyboard ----------------------------------------------------------
  let capture: { ownerId: number; sessionId: number; stop: () => void } | null = null
  let captureSequence = 0
  handle('keyboard:begin-shortcut-capture', event => {
    if (capture !== null && capture.ownerId !== event.sender.id) throw new Error('Shortcut capture is owned by another window')
    const state = recordingMachine.getState()
    if (!['idle', 'error'].includes(state.phase)) throw new Error("Finish the current recording first")
    capture?.stop()
    const ownerId = event.sender.id
    const sessionId = ++captureSequence
    const previousDisabled = recordingMachine.isDisabled()
    const window = BrowserWindow.fromWebContents(event.sender)
    let off: (() => void) | null = null
    const cleanup = () => {
      if (capture?.ownerId !== ownerId || capture.sessionId !== sessionId) return
      capture = null
      window?.removeListener('blur', cleanup)
      event.sender.removeListener('destroyed', cleanup)
      event.sender.removeListener('render-process-gone', cleanup)
      try {
        off?.()
      } finally {
        try {
          keyboard.setShortcutCaptureEnabled?.(0)
        } finally {
          recordingMachine.setDisabled(previousDisabled)
          refreshShortcutRegistrations()
        }
      }
    }
    capture = { ownerId, sessionId, stop: cleanup }
    try {
      recordingMachine.setDisabled(true)
      globalShortcut.unregisterAll()
      off = keyboard.onKey(key => {
        if (capture?.ownerId === ownerId && capture.sessionId === sessionId && !event.sender.isDestroyed() && (key.capture || !keyboard.setShortcutCaptureEnabled)) {
          event.sender.send('keyboard:shortcut-captured', { ...key, sessionId })
        }
      })
      window?.once('blur', cleanup)
      event.sender.once('destroyed', cleanup)
      event.sender.once('render-process-gone', cleanup)
      keyboard.setShortcutCaptureEnabled?.(1)
      return { native: keyboard.running && Boolean(keyboard.setShortcutCaptureEnabled), sessionId }
    } catch (error) {
      cleanup()
      throw error
    }
  })
  handle('keyboard:end-shortcut-capture', (event, requestedSessionId: unknown) => {
    if (capture?.ownerId === event.sender.id && capture.sessionId === requestedSessionId) capture.stop()
    return true
  })

  handle('keyboard:start-keyboard-listener', () => {
    if (!keyboard.available) return { ok: false, reason: 'helper-unavailable' }
    refreshTargetShortcuts()
    const result = keyboard.start()
    refreshShortcutRegistrations()
    return { ok: result === 0, code: result }
  })

  handle('keyboard:stop-keyboard-listener', () => {
    keyboard.stop()
    refreshShortcutRegistrations()
    return true
  })

  handle('keyboard:set-watcher-interval', (_e, ms: number) => {
    return keyboard.setWatcherInterval?.(ms) ?? 0
  })

  handle('keyboard:type-transcript', async (_e, text: string) => {
    return insertText(String(text ?? ''), { addTrailingSpace: false })
  })

  // ---- recording machine -------------------------------------------------
  handle('recording-machine:set-disabled', (_e, disabled: boolean) => {
    recordingMachine.setDisabled(Boolean(disabled))
    return true
  })
  handle('recording-machine:get-disabled', () => recordingMachine.isDisabled())
  handle('recording-machine:state', () => recordingMachine.getState())
  handle('recording-machine:status', async (_e, phase: string, payload?: any) => {
    if (typeof payload?.sessionId !== 'string') return false
    if (phase === 'started') recordingMachine.markStreaming(payload.sessionId)
    if (phase === 'stopped') recordingMachine.markStopped(payload.sessionId)
    if (phase === 'error') recordingMachine.reportError(payload.sessionId, payload.message ?? payload.error ?? "Could not start the microphone")
    if (phase === 'chunk' && payload?.pcm) {
      const pcm = new Float32Array(payload.pcm)
      recordingMachine.pushPcm(pcm, payload.sessionId)
    }
    return true
  })

  // ---- analytics ---------------------------------------------------------
  handle('mixpanel:track-event', (_e, event: string, props?: Record<string, unknown>) => {
    if (!settings.get().telemetryEnabled) return false
    log.debug(`event ${event}`, props)
    return true
  })

  // ---- housekeeping ------------------------------------------------------
  handle('app:open-data-dir', async () => {
    await shell.openPath(settings.get() ? join((await import('../lib/paths')).paths.userData) : '')
    return true
  })

  handle('diagnostics:native-status', () => ({
    input: input.available,
    keyboard: keyboard.available,
    context: context.available,
    util: util.available,
    accessibility: (util.checkAccessibilityPermission?.(0) ?? 0) === 1
  }))
}

function refreshTargetShortcuts(): void {
  const values = new Set<string>()
  for (const { binding } of shortcutBindings()) {
    if (binding?.enabled && binding.accelerator) values.add(binding.accelerator)
  }
  try {
    keyboard.updateTargetShortcuts?.(JSON.stringify([...values]))
  } catch (err) {
    log.warn('failed to publish shortcuts', err)
  }
}
