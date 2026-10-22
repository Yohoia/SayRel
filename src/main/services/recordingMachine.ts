import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { paths } from '../lib/paths'
import { createLogger } from '../lib/logger'
import { AUDIO, HISTORY_STATUS, MODES, type Mode } from '../../shared/constants'
import type { AudioContextSnapshot, VoiceFlowResult } from '../../shared/types'
import type { Settings } from '../../shared/settings'
import { broadcast, interactiveCardWindow } from '../windows'
import { IPC } from '../../shared/ipc'
import * as history from './history'
import { listDictionary } from './dictionary'
import { insertText } from './insertion'
import { transcribe } from './transcription'
import { createProviders } from './providers'
import { runVoiceAction } from './voiceActions'
import { settings } from '../lib/settings'
import { captureAudioContext } from './contextCapture'
import { recordingSetupIssue, type RecordingIssue } from '../../shared/recordingFeedback'
import type { OwnedPracticeTarget, PracticeTarget } from '../../shared/featureTour'

const log = createLogger('recording-machine')
export type RecorderPhase = 'idle' | 'long_pressing' | 'starting' | 'recording' | 'finishing' | 'error'
export interface RecorderContext {
  sessionId: string | null
  recorderState: { isStartingMicrophone: boolean }
  recorderTimeoutState: { remainingTime: number; timeUntilCountdown: number } | null
  handsFree: boolean
  mode: Mode
  error: string | null
  issue: RecordingIssue | null
}
export interface RecordingMachineState { phase: RecorderPhase; context: RecorderContext }
type MachineEvent = { type: 'PRESS' | 'RELEASE' | 'STARTED' | 'FINISH' | 'CANCEL' | 'RETRY' | 'TIMEOUT' | 'ERROR'; error?: string }
type Session = {
  id: string; startedAt: number; mode: Mode; frames: Float32Array[]
  context: Promise<AudioContextSnapshot | null>; config: Settings; controller: AbortController
  stopped: boolean; stoppedAt?: number; resolveStop?: () => void; stopTimer?: NodeJS.Timeout
  historyRetry?: boolean
  completion?: Promise<void>; historyWritten: boolean
  practice: OwnedPracticeTarget | null
}

/** Main owns session identity; renderer owns the microphone and acknowledges its drain. */
export class RecordingMachine extends EventEmitter {
  private state: RecordingMachineState = { phase: 'idle', context: {
    sessionId: null, recorderState: { isStartingMicrophone: false }, recorderTimeoutState: null,
    handsFree: false, mode: MODES.VOICE_TRANSCRIPT, error: null, issue: null
  } }
  private session: Session | null = null
  private disabled = false
  private practiceScope: { kind: 'closed' } | { kind: 'blocked'; ownerId: number } | ({ kind: 'ready' } & OwnedPracticeTarget) = { kind: 'closed' }

  blockPractice(ownerId: number): void {
    if (this.practiceScope.kind !== 'closed' && this.practiceScope.ownerId !== ownerId) throw new Error('A practice is already open in another window')
    if (this.session && this.session.practice?.ownerId !== ownerId) throw new Error('Finish the current recording first')
    this.setPracticeTarget(ownerId, null)
    this.practiceScope = { kind: 'blocked', ownerId }
  }

  setPracticeTarget(ownerId: number, target: PracticeTarget | null): void {
    const current = this.practiceScope
    if (!target && (current.kind === 'closed' || current.ownerId !== ownerId)) return
    if (target && current.kind !== 'closed' && current.ownerId !== ownerId) throw new Error('A practice is already open in another window')
    if (target && this.session && this.session.practice?.ownerId !== ownerId) throw new Error('Finish the current recording first')
    if (current.kind === 'ready' && (current.ownerId !== ownerId || current.target.id !== target?.id)) this.cancel()
    this.practiceScope = target ? { kind: 'ready', ownerId, target: structuredClone(target) } : { kind: 'closed' }
  }
  async startPractice(ownerId: number): Promise<void> {
    if (this.practiceScope.kind !== 'ready' || this.practiceScope.ownerId !== ownerId) throw new Error('Open a practice first')
    await this.start(this.practiceScope.target.mode)
    if (this.session) this.setHandsFree(true)
  }
  finishPractice(ownerId: number): Promise<void> {
    return this.session?.practice?.ownerId === ownerId ? this.finish() : Promise.resolve()
  }
  private countdown: NodeJS.Timeout | null = null
  private retryInput: { pcm: Float32Array; mode: Mode; durationMs: number; context: AudioContextSnapshot | null; config: Settings } | null = null

  getState(): RecordingMachineState { return this.state }
  isDisabled(): boolean { return this.disabled }
  setDisabled(value: boolean): void {
    this.disabled = value
    if (value) this.cancel()
    broadcast(IPC.RECORDING_MACHINE_DISABLED_CHANGED, value)
  }
  private transition(phase: RecorderPhase, patch: Partial<RecorderContext> = {}): void {
    if (phase !== this.state.phase) log.debug('recorder phase changed', { from: this.state.phase, to: phase, issue: patch.issue?.kind ?? null })
    this.state = { phase, context: { ...this.state.context, ...patch } }
    this.emit('state', this.state)
    broadcast('recording-machine:state', this.state)
  }
  private active(session: Session): boolean { return this.session === session && !session.controller.signal.aborted }
  private requireActive(session: Session): void {
    if (!this.active(session)) throw new Error('Recording cancelled')
  }
  markStreaming(sessionId: string): void {
    if (sessionId !== this.session?.id || this.state.phase !== 'starting') return
    this.session.startedAt = Date.now()
    this.transition('recording', { recorderState: { isStartingMicrophone: false } })
  }
  pushPcm(chunk: Float32Array, sessionId: string): void {
    const session = this.session
    if (!session || sessionId !== session.id || session.stopped) return
    if (!['starting', 'recording', 'finishing'].includes(this.state.phase)) return
    session.frames.push(chunk)
  }
  markStopped(sessionId: string): void {
    if (!this.session || sessionId !== this.session.id) return
    this.session.stopped = true
    this.session.stoppedAt = Date.now()
    this.session.resolveStop?.()
  }
  reportError(sessionId: string, message: string): void {
    if (!this.session || sessionId !== this.session.id) return
    this.fail(this.session, new Error(message))
  }
  switchMode(mode: Mode): void {
    if (!this.session || !['starting', 'recording'].includes(this.state.phase)) return
    if (this.session.practice && mode !== this.session.practice.target.mode) return
    const issue = recordingSetupIssue(this.session.config, mode)
    if (issue) { this.showSetupIssue(mode, issue); return }
    this.session.mode = mode
    this.transition(this.state.phase, { mode })
  }
  selectTranslationLanguage(language: string): boolean {
    if (this.session && !['starting', 'recording'].includes(this.state.phase)) return false
    if (!settings.get().translationTargetLanguages.includes(language)) return false
    if (this.session) this.session.config.translationTargetLanguage = language
    return true
  }
  setHandsFree(handsFree: boolean): void { this.transition(this.state.phase, { handsFree }) }
  setLongPressing(): void {
    if (!['starting', 'recording'].includes(this.state.phase)) return
    this.cancel()
    this.transition('long_pressing')
  }
  async dispatch(event: MachineEvent): Promise<void> {
    switch (event.type) {
      case 'PRESS': return this.start()
      case 'RELEASE':
        if (this.state.phase === 'long_pressing') return this.cancel()
        if (['starting', 'recording'].includes(this.state.phase)) return this.finish()
        return
      case 'FINISH': case 'TIMEOUT': return this.finish()
      case 'CANCEL': return this.cancel()
      case 'RETRY': return this.retry()
      case 'ERROR': if (this.session) this.reportError(this.session.id, event.error ?? "Recording failed"); return
      default: return
    }
  }
  private newSession(mode: Mode): Session {
    return { id: randomUUID(), startedAt: Date.now(), mode, frames: [],
      context: Promise.resolve(null), config: structuredClone(settings.get()),
      controller: new AbortController(), stopped: false, historyWritten: false, practice: this.practiceScope.kind === 'ready' ? { ownerId: this.practiceScope.ownerId, target: structuredClone(this.practiceScope.target) } : null }
  }
  private showSetupIssue(mode: Mode, issue: RecordingIssue): void {
    this.releaseSession()
    this.retryInput = null
    this.transition('error', { sessionId: null, mode, error: issue.message, issue,
      handsFree: false, recorderState: { isStartingMicrophone: false }, recorderTimeoutState: null })
  }
  async start(mode?: Mode): Promise<void> {
    if (this.disabled || this.session || this.state.phase === 'long_pressing') return
    const requestedMode = mode ?? settings.get().dictationMode
    if (this.practiceScope.kind === 'blocked' || this.practiceScope.kind === 'ready' && requestedMode !== this.practiceScope.target.mode) return
    const issue = recordingSetupIssue(settings.get(), requestedMode)
    if (issue) { this.showSetupIssue(requestedMode, issue); return }
    const session = this.newSession(requestedMode)
    this.session = session
    this.retryInput = null
    // Capture the target before any renderer can focus a window.
    if (session.practice) {
      session.config.historyEnabled = false
      session.config.saveAudio = false
      const target = session.practice.target
      session.context = Promise.resolve({ focusedApp: null, visibleText: null,
        focusedInput: { role: target.kind === 'rewrite' ? 'AXTextArea' : 'AXStaticText', valuePreview: 'selectedText' in target ? target.selectedText : '', selectedText: 'selectedText' in target ? target.selectedText : '', isSecure: false, bounds: null } })
    } else {
      session.context = captureAudioContext().catch(err => { log.warn('context capture failed', err); return null })
    }
    this.transition('starting', { sessionId: session.id, mode: session.mode, error: null, issue: null,
      handsFree: false, recorderState: { isStartingMicrophone: true }, recorderTimeoutState: null })
    this.countdown = setInterval(() => {
      if (!this.active(session)) return
      const remaining = Math.max(0, 300 - Math.floor((Date.now() - session.startedAt) / 1000))
      this.transition(this.state.phase, { recorderTimeoutState: { remainingTime: remaining, timeUntilCountdown: Math.max(0, remaining - 30) } })
      if (remaining === 0) void this.finish()
    }, 1000)
    this.emit('start', { sessionId: session.id, mode: session.mode })
  }
  finish(): Promise<void> {
    const session = this.session
    if (!session) return Promise.resolve()
    if (session.completion) return session.completion
    this.stopCountdown()
    // Install the ACK waiter before publishing finishing: even immediate ACKs cannot be lost.
    const drained = new Promise<void>((resolve, reject) => {
      session.resolveStop = resolve
      session.stopTimer = setTimeout(() => reject(new Error("The microphone timed out while stopping. Check permissions and try again.")), 15000)
    })
    this.transition('finishing', { recorderState: { isStartingMicrophone: false }, recorderTimeoutState: null })
    session.completion = (async () => {
      try {
        await drained
        clearTimeout(session.stopTimer)
        this.requireActive(session)
        const context = await session.context
        this.requireActive(session)
        const input = { pcm: mergeFrames(session.frames), mode: session.mode,
          durationMs: (session.stoppedAt ?? Date.now()) - session.startedAt, context, config: structuredClone(session.config) }
        session.frames = []
        if (!input.pcm.length) { this.cancel(); return }
        this.retryInput = input
        await this.complete(session, input)
      } catch (err) { if (this.active(session)) this.fail(session, err) }
      finally { clearTimeout(session.stopTimer) }
    })()
    return session.completion
  }
  private async complete(session: Session, input: { pcm: Float32Array; mode: Mode; durationMs: number; context: AudioContextSnapshot | null; audioPath?: string }): Promise<void> {
    const result = await this.process(session, input)
    this.requireActive(session)
    this.session = null
    this.retryInput = null
    this.transition('idle', { sessionId: null, recorderState: { isStartingMicrophone: false }, handsFree: false, recorderTimeoutState: null })
    this.emit('result', result)
    if (session.practice) {
      this.emit('practice-result', { ownerId: session.practice.ownerId, targetId: session.practice.target.id, transcript: result.transcript, text: result.refined })
      return
    }
    if (result.delivery === 'card') {
      interactiveCardWindow.setPayload({ id: result.id, mode: result.mode, title: result.transcript,
        question: result.transcript, selectedText: input.context?.focusedInput?.selectedText ?? null,
        answer: result.refined, createdAt: Date.now() })
      interactiveCardWindow.createWindow()
      interactiveCardWindow.show()
    }
    broadcast(IPC.PAGE_FLOATING_BAR_CLICK, 'done', result)
    broadcast('history:changed')
  }
  private releaseSession(): Session | null {
    const session = this.session
    this.session = null
    this.stopCountdown()
    if (session) {
      session.controller.abort()
      clearTimeout(session.stopTimer)
      session.resolveStop?.()
      session.frames = []
    }
    return session
  }
  cancel(): void {
    const session = this.releaseSession()
    this.retryInput = null
    if (session?.historyWritten) history.upsertHistory({ id: session.id, status: HISTORY_STATUS.CANCELLED })
    this.transition('idle', { sessionId: null, recorderState: { isStartingMicrophone: false }, recorderTimeoutState: null, handsFree: false, error: null, issue: null })
    this.emit('cancel')
  }
  private fail(session: Session, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    log.error('voice flow failed', { message })
    const issue: RecordingIssue = this.state.phase === 'starting' || this.state.phase === 'recording'
      ? { kind: 'microphone', message }
      : { kind: 'processing', message, canRetry: this.retryInput !== null }
    this.releaseSession()
    if (session.historyWritten) history.upsertHistory({ id: session.id, status: HISTORY_STATUS.FAILED, debugInfo: message })
    this.transition('error', { sessionId: null, error: message, issue, recorderState: { isStartingMicrophone: false }, handsFree: false, recorderTimeoutState: null })
    broadcast(IPC.PAGE_FLOATING_BAR_CLICK, 'error', message)
    broadcast('history:changed')
  }
  async retry(): Promise<void> {
    if (!this.retryInput) {
      await this.start()
      this.setHandsFree(true)
      return
    }
    if (this.session || this.disabled) return
    const session = this.newSession(this.retryInput.mode)
    session.config = structuredClone(this.retryInput.config)
    this.session = session
    this.transition('finishing', { sessionId: session.id, mode: session.mode, error: null, issue: null })
    try { await this.complete(session, this.retryInput) }
    catch (err) { if (this.active(session)) this.fail(session, err) }
  }
  async retryHistory(id: string): Promise<void> {
    if (this.practiceScope.kind !== 'closed') throw new Error('Exit the practice before retrying history')
    if (this.session || this.disabled) throw new Error("Wait for the current recording to finish processing")
    const row = history.getHistory(id)
    if (!row?.audioLocalPath) throw new Error("No audio was saved for this recording, so it cannot be retried")
    const session = this.newSession(row.mode as Mode)
    session.id = id
    session.historyRetry = true
    this.retryInput = null
    this.session = session
    this.transition('finishing', { sessionId: id, mode: session.mode, error: null, issue: null })
    let context: AudioContextSnapshot | null = null
    try { context = row.audioContext ? JSON.parse(row.audioContext) : null } catch { /* older record */ }
    try { await this.complete(session, { pcm: new Float32Array(), mode: session.mode, durationMs: row.duration ?? 0, context, audioPath: row.audioLocalPath }) }
    catch (err) {
      if (this.active(session)) this.fail(session, err)
      throw err
    }
  }
  private async process(session: Session, input: { pcm: Float32Array; mode: Mode; durationMs: number; context: AudioContextSnapshot | null; audioPath?: string }): Promise<VoiceFlowResult> {
    const config = session.config
    const dictionary = listDictionary().map(entry => entry.word)
    this.requireActive(session)
    if (config.historyEnabled || session.historyRetry) {
      history.upsertHistory({ id: session.id, status: HISTORY_STATUS.PROCESSING, mode: input.mode,
        duration: input.durationMs, audioContext: input.context ? JSON.stringify(input.context) : null,
        micDevice: config.micDevice, appVersion: process.env.npm_package_version ?? '1.0.0' })
      session.historyWritten = true
    }
    const { result, ogg } = await transcribe({ pcm: input.pcm, audioPath: input.audioPath,
      durationMs: input.durationMs, language: config.transcriptionLanguage, dictionary,
      context: input.context, mode: input.mode, config, signal: session.controller.signal })
    this.requireActive(session)
    if (config.historyEnabled && config.saveAudio && ogg.length) {
      const file = join(paths.recordings, `${session.id}.ogg`)
      await writeFile(file, ogg)
      this.requireActive(session)
      history.upsertHistory({ id: session.id, audioLocalPath: file })
    }
    let refined = result.text
    if (result.text && (input.mode === 'ask_anything' || input.mode === 'translation')) {
      refined = await runVoiceAction({ transcript: result.text, mode: input.mode, context: input.context, config, signal: session.controller.signal,
        action: session.practice?.target.kind === 'rewrite' ? 'rewrite' : 'question' })
    } else if (result.text) {
      try {
        refined = (await createProviders(config.provider, config.serviceProviders).refinement.refine({ transcript: result.text, mode: input.mode,
          language: result.detectedLanguage, dictionary, context: input.context, instructions: config.customInstructions || undefined, signal: session.controller.signal })).text
      } catch (err) { log.warn('refinement failed, using raw transcript', err) }
    }
    this.requireActive(session)
    let delivery: VoiceFlowResult['delivery'] = 'card'
    if (!session.practice && input.mode !== 'ask_anything' && !session.historyRetry) {
      const outcome = await insertText(refined, { addTrailingSpace: config.addTrailingSpace, isCancelled: () => !this.active(session) })
      delivery = outcome.ok ? 'insert' : 'clipboard'
    }
    this.requireActive(session)
    if (config.historyEnabled || session.historyRetry) history.upsertHistory({ id: session.id, status: HISTORY_STATUS.COMPLETED, refinedText: refined,
      modeMeta: JSON.stringify({ transcript: result.text, aiResult: { text: refined, delivery } }) })
    return { id: session.id, transcript: result.text, refined, delivery, mode: input.mode, durationMs: input.durationMs, detectedLanguage: result.detectedLanguage }
  }
  private stopCountdown(): void { if (this.countdown) clearInterval(this.countdown); this.countdown = null }
}
function mergeFrames(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((sum, frame) => sum + frame.length, 0))
  let offset = 0
  for (const frame of frames) { out.set(frame, offset); offset += frame.length }
  return out
}
export const recordingMachine = new RecordingMachine()
export { AUDIO }
