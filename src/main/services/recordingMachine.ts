import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { paths } from '../lib/paths'
import { createLogger } from '../lib/logger'
import { AUDIO, HISTORY_STATUS, MODES, type Mode } from '../../shared/constants'
import type { AudioContextSnapshot, TranscriptionResult, VoiceFlowResult } from '../../shared/types'
import type { Settings } from '../../shared/settings'
import { broadcast, interactiveCardWindow, windows } from '../windows'
import { IPC } from '../../shared/ipc'
import * as history from './history'
import { listDictionary } from './dictionary'
import { insertText } from './insertion'
import { transcribe, recognitionLanguage } from './transcription'
import { startLiveTranscription, supportsLiveTranscription } from './providers/realtime'
import type { LiveTranscriptionSession } from './providers/realtimeTransport'
import type { AsrOutcome } from '../../shared/asr'
import { REFINEMENT_PROMPT_VERSION } from './providers/refinementPrompt'
import { cancelDesktopPlan, prepareDesktopPlan } from './desktopCommands'
import { createProviders } from './providers'
import { runVoiceAction } from './voiceActions'
import { settings } from '../lib/settings'
import { captureAudioContext } from './contextCapture'
import { recordingSetupIssue, type RecordingIssue } from '../../shared/recordingFeedback'
import type { OwnedPracticeTarget, PracticeTarget } from '../../shared/featureTour'
import { providerConfigurationIssue, selectedProvider } from '../../shared/providers'
import { readVoiceMetadata, type RefinementOutcome } from '../../shared/refinement'
import type { InsertionOutcome } from '../../shared/insertion'

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
type MachineEvent =
  | { type: 'PRESS' | 'RELEASE' | 'START' | 'STARTED' | 'FINISH' | 'CANCEL' | 'RETRY' | 'TIMEOUT' }
  | { type: 'TOGGLE'; mode: Mode }
  | { type: 'SHORTCUT_PRESS' | 'SHORTCUT_UPGRADE'; gestureId: symbol; mode: Mode }
  | { type: 'SHORTCUT_RELEASE'; gestureId: symbol; action: 'finish' | 'hands-free' | 'cancel' }
  | { type: 'SHORTCUT_LONG_PRESS'; gestureId: symbol }
  | { type: 'ERROR'; error?: string }
type ShortcutModeEvent = Extract<MachineEvent, { type: 'SHORTCUT_PRESS' | 'SHORTCUT_UPGRADE' }>
type Session = {
  id: string; startedAt: number; mode: Mode; frames: Float32Array[]
  context: Promise<AudioContextSnapshot | null>; config: Settings; controller: AbortController
  stopped: boolean; stoppedAt?: number; resolveStop?: () => void; stopTimer?: NodeJS.Timeout
  historyRetry?: boolean
  refinementRetry?: boolean
  historyRefinement?: boolean
  completion?: Promise<void>; historyWritten: boolean
  practice: OwnedPracticeTarget | null
  live?: LiveTranscriptionSession
  liveFailure?: string
  firstPartialAt?: number
  connectionReadyAt?: number
  asrFinalAt?: number
  asr?: AsrOutcome
  asrRequestId: string
  dictionary: string[]
}
type ShortcutGesture =
  | { kind: 'pending' | 'ignored' | 'long_pressing'; id: symbol }
  | { kind: 'recording'; id: symbol; sessionId: string }
type ProcessingContext = { mode: Mode; durationMs: number; context: AudioContextSnapshot | null }
type AudioInput = ProcessingContext & { kind: 'audio'; pcm: Float32Array; audioPath?: string }
type TranscriptInput = ProcessingContext & { kind: 'transcript'; result: TranscriptionResult; asr?: AsrOutcome }
type ProcessingInput = AudioInput | TranscriptInput

/** Main owns session identity; renderer owns the microphone and acknowledges its drain. */
export class RecordingMachine extends EventEmitter {
  private state: RecordingMachineState = { phase: 'idle', context: {
    sessionId: null, recorderState: { isStartingMicrophone: false }, recorderTimeoutState: null,
    handsFree: false, mode: MODES.VOICE_TRANSCRIPT, error: null, issue: null
  } }
  private session: Session | null = null
  private shortcut: ShortcutGesture | null = null
  private disabled = false
  private stopLearningTracking: (() => void) | null = null
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
  private retryInput: (AudioInput & { config: Settings }) | null = null
  private refinementRetry: { id: string; input: TranscriptInput; config: Settings } | null = null

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
    this.beginAsr(this.session)
    this.transition('recording', { recorderState: { isStartingMicrophone: false } })
  }
  pushPcm(chunk: Float32Array, sessionId: string): void {
    const session = this.session
    if (!session || sessionId !== session.id || session.stopped) return
    if (!['starting', 'recording', 'finishing'].includes(this.state.phase)) return
    session.frames.push(chunk)
    session.live?.pushPcm(chunk)
  }
  private beginAsr(session: Session): void {
    const selected = selectedProvider(session.config.serviceProviders, 'transcription')
    if (!selected || !supportsLiveTranscription(selected.profile, selected.model)) return
    try {
      session.live = startLiveTranscription(selected.profile, selected.model, {
        sampleRate: AUDIO.SAMPLE_RATE, durationMs: 0, mode: session.mode,
        language: recognitionLanguage(session.config), languages: session.config.preferredLanguages,
        dictionary: session.dictionary, signal: session.controller.signal,
        providerPolish: session.mode === 'voice_transcript' && session.config.polishLevel !== 'raw'
      }, text => {
        if (!this.active(session) || session.stopped) return
        if (text.trim()) session.firstPartialAt ??= Date.now()
        broadcast('recording-machine:partial', { sessionId: session.id, requestId: session.asrRequestId, text })
      }, () => { if (this.active(session)) session.connectionReadyAt ??= Date.now() })
      for (const chunk of session.frames) session.live.pushPcm(chunk)
      void session.live.result.catch(() => {
        if (this.active(session)) log.warn('live ASR unavailable; retaining audio for batch fallback', { sessionId: session.id })
      })
      void session.live.result.then(() => { session.asrFinalAt = Date.now() }, () => {})
    } catch {
      session.liveFailure = 'Live connection could not be started'
    }
  }
  markStopped(sessionId: string): void {
    if (!this.session || sessionId !== this.session.id) return
    this.session.stopped = true
    this.session.stoppedAt = Date.now()
    void this.session.live?.finish()
    this.session.resolveStop?.()
  }
  reportError(sessionId: string, message: string): void {
    if (!this.session || sessionId !== this.session.id) return
    this.fail(this.session, new Error(message))
  }
  private switchMode(mode: Mode): void {
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
  private setHandsFree(handsFree: boolean): void { this.transition(this.state.phase, { handsFree }) }
  private setLongPressing(): void {
    if (!['starting', 'recording'].includes(this.state.phase)) return
    this.cancel()
    this.transition('long_pressing')
  }
  private startShortcut({ gestureId, mode }: ShortcutModeEvent): void {
    windows.floatingBar.createWindow()
    windows.floatingBar.show()
    void this.start(mode)
    this.shortcut = this.session
      ? { kind: 'recording', id: gestureId, sessionId: this.session.id }
      : { kind: 'pending', id: gestureId }
  }
  private pressShortcut(event: ShortcutModeEvent): void {
    this.shortcut = { kind: 'ignored', id: event.gestureId }
    if (this.disabled || this.state.phase === 'finishing' || this.state.phase === 'long_pressing') return
    if (this.state.phase === 'starting' || this.state.phase === 'recording') {
      void this.finish()
      return
    }
    this.startShortcut(event)
  }
  private upgradeShortcut(event: ShortcutModeEvent): void {
    const { gestureId, mode } = event
    const shortcut = this.shortcut
    if (!shortcut || shortcut.id !== gestureId || this.disabled) return
    if (shortcut.kind === 'recording' && this.session?.id === shortcut.sessionId) this.switchMode(mode)
    else if (shortcut.kind === 'pending' && (this.state.phase === 'idle' || this.state.phase === 'error')) this.startShortcut(event)
  }
  private releaseShortcut({ gestureId, action }: Extract<MachineEvent, { type: 'SHORTCUT_RELEASE' }>): Promise<void> | void {
    const shortcut = this.shortcut
    if (!shortcut || shortcut.id !== gestureId) return
    this.shortcut = null
    if (shortcut.kind === 'long_pressing') {
      if (this.state.phase === 'long_pressing') this.cancel()
      return
    }
    if (shortcut.kind !== 'recording' || this.session?.id !== shortcut.sessionId) return
    if (action === 'cancel') return this.cancel()
    if (this.state.phase !== 'starting' && this.state.phase !== 'recording') return
    if (action === 'finish') return this.finish()
    this.setHandsFree(true)
  }
  private longPressShortcut(gestureId: symbol): void {
    const shortcut = this.shortcut
    if (shortcut?.id !== gestureId || shortcut.kind !== 'recording' || this.session?.id !== shortcut.sessionId) return
    if (this.state.phase !== 'starting' && this.state.phase !== 'recording') return
    this.setLongPressing()
    this.shortcut = { kind: 'long_pressing', id: gestureId }
  }
  async dispatch(event: MachineEvent): Promise<void> {
    switch (event.type) {
      case 'SHORTCUT_PRESS': return this.pressShortcut(event)
      case 'SHORTCUT_UPGRADE': return this.upgradeShortcut(event)
      case 'SHORTCUT_RELEASE': return this.releaseShortcut(event)
      case 'SHORTCUT_LONG_PRESS': return this.longPressShortcut(event.gestureId)
      case 'PRESS': return this.start()
      case 'START': return this.start(undefined, { handsFree: true })
      case 'TOGGLE':
        if (this.disabled) return
        if (this.state.phase === 'starting' || this.state.phase === 'recording') return this.finish()
        if (this.state.phase === 'idle' || this.state.phase === 'error') {
          windows.floatingBar.createWindow()
          windows.floatingBar.show()
          return this.start(event.mode, { handsFree: true })
        }
        return
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
    return { id: randomUUID(), asrRequestId: randomUUID(), dictionary: listDictionary().map(entry => entry.word), startedAt: Date.now(), mode, frames: [],
      context: Promise.resolve(null), config: structuredClone(settings.get()),
      controller: new AbortController(), stopped: false, historyWritten: false, practice: this.practiceScope.kind === 'ready' ? { ownerId: this.practiceScope.ownerId, target: structuredClone(this.practiceScope.target) } : null }
  }
  private showSetupIssue(mode: Mode, issue: RecordingIssue): void {
    this.releaseSession()
    this.retryInput = null
    this.refinementRetry = null
    this.transition('error', { sessionId: null, mode, error: issue.message, issue,
      handsFree: false, recorderState: { isStartingMicrophone: false }, recorderTimeoutState: null })
  }
  async start(mode?: Mode, { handsFree = false }: { handsFree?: boolean } = {}): Promise<void> {
    if (this.disabled || this.session || this.state.phase === 'long_pressing') return
    const requestedMode = mode ?? settings.get().dictationMode
    if (requestedMode === 'desktop_command' && !settings.get().desktopCommandsEnabled) {
      this.showSetupIssue(requestedMode, { kind: 'processing', message: 'Enable Desktop commands in Personalization first.', canRetry: false })
      return
    }
    cancelDesktopPlan()
    if (this.practiceScope.kind === 'blocked' || this.practiceScope.kind === 'ready' && requestedMode !== this.practiceScope.target.mode) return
    const requireRefinement = this.practiceScope.kind === 'ready' && this.practiceScope.target.kind === 'dictation'
    const issue = recordingSetupIssue(settings.get(), requestedMode, { requireRefinement })
    if (issue) { this.showSetupIssue(requestedMode, issue); return }
    this.stopLearningTracking?.()
    this.shortcut = null
    const session = this.newSession(requestedMode)
    this.session = session
    this.retryInput = null
    this.refinementRetry = null
    // Capture the target before any renderer can focus a window.
    if (session.practice) {
      session.config.historyEnabled = false
      session.config.saveAudio = false
      const target = session.practice.target
      const destination = target.kind === 'dictation' ? target.destination : undefined
      const destinationNames = { chat: 'Chat', email: 'Email', notes: 'Notes', tasks: 'Tasks' }
      session.context = Promise.resolve({
        focusedApp: destination ? { appName: destinationNames[destination], bundleId: null, windowTitle: null, webTitle: null, webDomain: null, webUrl: null, capturedAt: Date.now() } : null,
        visibleText: null,
        focusedInput: { role: target.kind === 'rewrite' || target.kind === 'dictation' ? 'AXTextArea' : 'AXStaticText', valuePreview: 'selectedText' in target ? target.selectedText : null, selectedText: 'selectedText' in target ? target.selectedText : null, isSecure: false, bounds: null }
      })
    } else {
      session.context = captureAudioContext().catch(err => { log.warn('context capture failed', err); return null })
    }
    this.transition('starting', { sessionId: session.id, mode: session.mode, error: null, issue: null,
      handsFree, recorderState: { isStartingMicrophone: true }, recorderTimeoutState: null })
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
        const input = { kind: 'audio' as const, pcm: mergeFrames(session.frames), mode: session.mode,
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
  private async complete(session: Session, input: ProcessingInput): Promise<void> {
    const result = await this.process(session, input)
    this.requireActive(session)
    this.session = null
    this.retryInput = null
    const fallback = result.refinement?.kind === 'fallback'
    this.refinementRetry = fallback ? { id: session.id, config: structuredClone(session.config), input: {
      kind: 'transcript', mode: input.mode, durationMs: input.durationMs, context: input.context,
      result: { text: result.transcript, detectedLanguage: result.detectedLanguage, provider: 'saved-transcript' }, asr: result.asr
    } } : null
    this.transition('idle', { sessionId: null, recorderState: { isStartingMicrophone: false }, handsFree: false, recorderTimeoutState: null,
      error: null, issue: fallback ? { kind: 'refinement', message: 'Text refinement failed. Your original transcript is available. Retry refinement to open the revised text in a card.', canRetry: true } : null })
    this.emit('result', result)
    if (session.practice) {
      this.emit('practice-result', { ownerId: session.practice.ownerId, targetId: session.practice.target.id, transcript: result.transcript, text: result.refined, refinement: result.refinement })
      return
    }
    if (result.delivery === 'card') {
      interactiveCardWindow.setPayload({ id: result.id, mode: result.mode, title: result.transcript,
        userPrompt: result.transcript,
        question: result.transcript, selectedText: input.context?.focusedInput?.selectedText ?? null,
        answer: result.refined, refinement: result.mode === 'voice_transcript' || result.mode === 'voice_command' ? result.refinement : undefined,
        insertion: result.insertion, desktopPlan: result.desktopPlan, createdAt: Date.now() })
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
      session.live?.abort()
      clearTimeout(session.stopTimer)
      session.resolveStop?.()
      session.frames = []
    }
    return session
  }
  cancel(): void {
    cancelDesktopPlan()
    this.stopLearningTracking?.()
    this.shortcut = null
    const session = this.releaseSession()
    this.retryInput = null
    this.refinementRetry = null
    if (session?.historyWritten) history.upsertHistory({ id: session.id, status: HISTORY_STATUS.CANCELLED })
    this.transition('idle', { sessionId: null, recorderState: { isStartingMicrophone: false }, recorderTimeoutState: null, handsFree: false, error: null, issue: null })
    this.emit('cancel')
  }
  private fail(session: Session, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    log.error('voice flow failed', { message })
    const issue: RecordingIssue = this.state.phase === 'starting' || this.state.phase === 'recording'
      ? { kind: 'microphone', message }
      : { kind: 'processing', message, canRetry: this.retryInput !== null || this.refinementRetry !== null }
    if (!session.asr) {
      const selected = selectedProvider(session.config.serviceProviders, 'transcription')
      session.asr = { kind: 'failed', sessionId: session.id, requestId: session.asrRequestId,
        providerId: selected?.profile.id ?? 'unconfigured', model: selected?.model ?? '',
        path: session.liveFailure ? 'batch-fallback' : session.live ? 'live' : 'batch',
        startedAt: session.startedAt, completedAt: Date.now(), stoppedAt: session.stoppedAt,
        reason: /timed?\s*out|timeout/i.test(message) ? 'timeout' : /connection|network|connect/i.test(message) ? 'network' : 'provider', message }
    }
    this.releaseSession()
    if (session.historyWritten) history.upsertHistory({ id: session.id, status: HISTORY_STATUS.FAILED, debugInfo: message,
      ...(session.asr.kind === 'failed' ? { modeMeta: JSON.stringify({ transcript: '', asr: session.asr }) } : {}) })
    this.transition('error', { sessionId: null, error: message, issue, recorderState: { isStartingMicrophone: false }, handsFree: false, recorderTimeoutState: null })
    broadcast(IPC.PAGE_FLOATING_BAR_CLICK, 'error', message)
    broadcast('history:changed')
  }
  async retry(): Promise<void> {
    if (this.refinementRetry) {
      if (this.session || this.disabled) return
      const retained = this.refinementRetry
      const session = this.newSession(retained.input.mode)
      const current = settings.get()
      session.id = retained.id
      session.config = { ...structuredClone(retained.config), provider: structuredClone(current.provider), serviceProviders: structuredClone(current.serviceProviders),
        polishLevel: current.polishLevel, writingStyle: current.writingStyle, autoPunctuation: current.autoPunctuation,
        customInstructions: current.customInstructions, preferredLanguages: structuredClone(current.preferredLanguages),
        sendFocusedAppContext: current.sendFocusedAppContext, sendScreenContext: current.sendScreenContext }
      session.refinementRetry = true
      this.session = session
      this.transition('finishing', { sessionId: session.id, mode: session.mode, error: null, issue: null })
      try { await this.complete(session, { ...retained.input, context: retryContext(retained.input.context, current) }) }
      catch (err) { if (this.active(session)) this.fail(session, err) }
      return
    }
    if (!this.retryInput) {
      return this.dispatch({ type: 'START' })
    }
    if (this.session || this.disabled) return
    const retained = this.retryInput
    const session = this.newSession(retained.mode)
    const current = settings.get()
    session.config = { ...structuredClone(retained.config), sendFocusedAppContext: current.sendFocusedAppContext, sendScreenContext: current.sendScreenContext }
    this.session = session
    this.transition('finishing', { sessionId: session.id, mode: session.mode, error: null, issue: null })
    try { await this.complete(session, { ...retained, context: retryContext(retained.context, current) }) }
    catch (err) { if (this.active(session)) this.fail(session, err) }
  }
  async retryHistory(id: string, action: 'retry' | 'refine' = 'retry'): Promise<void> {
    if (this.practiceScope.kind !== 'closed') throw new Error('Exit the practice before retrying history')
    if (this.session || this.disabled) throw new Error("Wait for the current recording to finish processing")
    const row = history.getHistory(id)
    if (!row) throw new Error('This recording is no longer available')
    const metadata = readVoiceMetadata(row.modeMeta?.toString() ?? null)
    if (action === 'refine') {
      if (row.mode !== 'voice_transcript') throw new Error('Only saved dictations can be refined again')
      if (!metadata?.transcript.trim()) throw new Error('No original transcript is available for this dictation')
      const selected = selectedProvider(settings.get().serviceProviders, 'refinement')
      if (!selected || providerConfigurationIssue(selected.profile)) throw new Error('Choose a default writing model in Providers before retrying refinement.')
    }
    const refinementOnly = (action === 'refine' || metadata?.refinement?.kind === 'fallback') && !!metadata?.transcript
    if (!refinementOnly && !row.audioLocalPath) throw new Error("No audio was saved for this recording, so it cannot be retried")
    const session = this.newSession(row.mode as Mode)
    session.id = id
    session.historyRetry = true
    session.historyRefinement = action === 'refine'
    this.retryInput = null
    this.refinementRetry = null
    this.session = session
    this.transition('finishing', { sessionId: id, mode: session.mode, error: null, issue: null })
    let context: AudioContextSnapshot | null = null
    try { context = row.audioContext ? JSON.parse(row.audioContext) : null } catch { /* older record */ }
    context = retryContext(context, session.config)
    const input: ProcessingInput = refinementOnly ? {
      kind: 'transcript', mode: session.mode, durationMs: row.duration ?? 0, context,
      result: { text: metadata.transcript, detectedLanguage: metadata.detectedLanguage ?? null, provider: 'saved-transcript' }, asr: metadata.asr
    } : { kind: 'audio', pcm: new Float32Array(), mode: session.mode, durationMs: row.duration ?? 0, context, audioPath: row.audioLocalPath ?? undefined }
    try { await this.complete(session, input) }
    catch (err) {
      if (this.active(session)) this.fail(session, err)
      throw err
    }
  }
  private async process(session: Session, input: ProcessingInput): Promise<VoiceFlowResult> {
    const config = session.config
    const dictionary = session.dictionary
    this.requireActive(session)
    if ((config.historyEnabled || session.historyRetry) && !session.historyRefinement) {
      history.upsertHistory({ id: session.id, status: HISTORY_STATUS.PROCESSING, mode: input.mode,
        duration: input.durationMs, audioContext: input.context ? JSON.stringify(input.context) : null,
        micDevice: config.micDevice, appVersion: process.env.npm_package_version ?? '1.0.0' })
      session.historyWritten = true
    }
    const result = input.kind === 'transcript' ? input.result : (await transcribe({ pcm: input.pcm, audioPath: input.audioPath,
      durationMs: input.durationMs, language: recognitionLanguage(config), dictionary,
      context: input.context, mode: input.mode, config, signal: session.controller.signal,
      liveResult: session.live?.result,
      onLiveFallback: () => { session.liveFailure = 'Live transcription failed; retried with the complete recording' },
      onAudioEncoded: async ogg => {
        if (!config.historyEnabled || !config.saveAudio || session.historyRetry) return
        this.requireActive(session)
        const file = join(paths.recordings, `${session.id}.ogg`)
        await writeFile(file, ogg)
        if (!this.active(session)) {
          await unlink(file).catch(err => log.warn('cancelled audio cleanup failed', err))
          this.requireActive(session)
        }
        history.upsertHistory({ id: session.id, audioLocalPath: file })
      } })).result
    this.requireActive(session)
    const selectedAsr = selectedProvider(config.serviceProviders, 'transcription')
    const identity = { sessionId: session.id, requestId: session.asrRequestId,
      providerId: selectedAsr?.profile.id ?? result.provider, model: selectedAsr?.model ?? 'saved-transcript',
      path: input.kind === 'transcript' ? 'saved' as const : session.liveFailure ? 'batch-fallback' as const : session.live ? 'live' as const : 'batch' as const,
      startedAt: session.startedAt, completedAt: session.live && !session.liveFailure ? session.asrFinalAt ?? Date.now() : Date.now(), stoppedAt: session.stoppedAt,
      connectionReadyAt: session.connectionReadyAt, firstPartialAt: session.firstPartialAt, streamFailure: session.liveFailure }
    session.asr = input.kind === 'transcript' && input.asr ? input.asr : result.text.trim() ? { ...identity, kind: 'final', asrText: result.text,
      detectedLanguage: result.detectedLanguage, confidence: result.confidence, providerPolish: result.providerPolish } : { ...identity, kind: 'empty', asrText: '' }
    if (session.historyWritten && input.kind === 'audio') history.upsertHistory({ id: session.id, refinedText: result.text,
      modeMeta: JSON.stringify({ transcript: result.text, detectedLanguage: result.detectedLanguage, asr: session.asr }) })
    if (session.asr.kind === 'empty') throw new Error('No speech was detected. Check the microphone and try again.')
    if (input.mode === 'desktop_command') {
      if (session.asr.kind !== 'final' || session.historyRetry || session.refinementRetry) throw new Error('Record a new complete desktop command before executing an action')
      const command = prepareDesktopPlan(session.asr, input.context, config.historyEnabled ? session.id : null)
      if (session.historyWritten) history.upsertHistory({ id: session.id, status: HISTORY_STATUS.COMPLETED, refinedText: command.answer,
        modeMeta: JSON.stringify({ transcript: result.text, asr: session.asr, desktopCommand: {
          status: command.plan ? 'awaiting_confirmation' : 'unsupported', plan: command.plan,
          events: [{ status: command.plan ? 'awaiting_confirmation' : 'unsupported', at: Date.now() }]
        } }) })
      return { id: session.id, transcript: result.text, refined: command.answer, delivery: 'card', mode: input.mode,
        durationMs: input.durationMs, detectedLanguage: result.detectedLanguage, asr: session.asr, desktopPlan: command.plan }
    }
    let refined = result.text
    let refinement: RefinementOutcome = { kind: 'skipped' }
    if (result.text && (input.mode === 'ask_anything' || input.mode === 'translation')) {
      refined = await runVoiceAction({ transcript: result.text, mode: input.mode, context: input.context, config, signal: session.controller.signal,
        action: session.practice?.target.kind === 'rewrite' ? 'rewrite' : 'question' })
    } else if (result.text) {
      const selection = selectedProvider(config.serviceProviders, 'refinement')
      if (input.kind === 'transcript' && (!selection || providerConfigurationIssue(selection.profile))) throw new Error('Choose a default writing model in Providers before retrying refinement.')
      if (selection) {
        const startedAt = Date.now()
        const writing = { providerId: selection.profile.id, model: selection.model, promptVersion: REFINEMENT_PROMPT_VERSION,
          polishLevel: config.polishLevel, writingStyle: config.writingStyle, autoPunctuation: config.autoPunctuation }
        const details = { sessionId: session.id, mode: input.mode, ...writing }
        log.info('refinement started', { ...details, transcriptLength: result.text.length })
        try {
          refined = (await createProviders(config.provider, config.serviceProviders).refinement.refine({ transcript: result.text, mode: input.mode,
            language: result.detectedLanguage, languages: config.preferredLanguages, dictionary, context: input.context, instructions: config.customInstructions || undefined,
            polishLevel: config.polishLevel, writingStyle: config.writingStyle, autoPunctuation: config.autoPunctuation, signal: session.controller.signal })).text
          refinement = { kind: 'completed', ...writing, changed: refined !== result.text, durationMs: Date.now() - startedAt }
          log.info('refinement completed', { ...details, durationMs: Date.now() - startedAt, changed: refined !== result.text, outputLength: refined.length })
        } catch (err) {
          this.requireActive(session)
          if (session.historyRefinement) throw err
          refinement = { kind: 'fallback', ...writing, message: err instanceof Error ? err.message : 'Text refinement failed. Please try again.' }
          log.warn('refinement failed, using raw transcript', { ...details, durationMs: Date.now() - startedAt, message: refinement.message })
        }
      } else {
        refinement = { kind: 'skipped', reason: 'no-default-provider' }
        log.info('refinement skipped', { sessionId: session.id, mode: input.mode, reason: 'no-default-provider', credentialsUnavailable: config.providerCredentialsUnavailable })
      }
    }
    this.requireActive(session)
    let delivery: VoiceFlowResult['delivery'] = 'card'
    let insertionMs = 0
    let insertion: InsertionOutcome | undefined
    if (!session.practice && input.mode !== 'ask_anything' && !session.historyRetry && !session.refinementRetry) {
      const learning = config.dictionaryLearning && input.mode === 'voice_transcript' && session.asr.kind === 'final'
        ? await import('./dictionaryLearning') : null
      this.requireActive(session)
      const before = learning?.captureLearningSnapshot()
      if (learning) this.stopLearningTracking = learning.stopDictionaryTracking
      const insertionStartedAt = Date.now()
      const outcome = await insertText(refined, { addTrailingSpace: config.addTrailingSpace, isCancelled: () => !this.active(session) })
      insertion = outcome
      insertionMs = Date.now() - insertionStartedAt
      delivery = outcome.ok ? 'insert' : outcome.method === 'clipboard' ? 'clipboard' : 'card'
      if (outcome.ok && before && learning && this.active(session)) learning.trackInsertedDictation({
        requestId: session.asrRequestId, historyId: config.historyEnabled ? session.id : null, before,
        inserted: refined, asrText: result.text
      })
    }
    this.requireActive(session)
    if (session.historyRefinement && !history.getHistory(session.id)) throw new Error('This recording is no longer available')
    if (config.historyEnabled || session.historyRetry) history.upsertHistory({ id: session.id, status: HISTORY_STATUS.COMPLETED, refinedText: refined,
      modeMeta: JSON.stringify({ transcript: result.text, detectedLanguage: result.detectedLanguage, asr: session.asr, refinement,
        insertion, deliveryTiming: { insertionMs, completedAt: Date.now() }, aiResult: { text: refined, delivery } }) })
    log.info('voice flow completed', { sessionId: session.id, requestId: session.asrRequestId, path: session.asr.path,
      firstPartialMs: session.firstPartialAt ? session.firstPartialAt - session.startedAt : null,
      connectionMs: session.connectionReadyAt ? session.connectionReadyAt - session.startedAt : null, insertionMs, insertionVerification: insertion?.verification,
      stopToFinalMs: session.stoppedAt ? session.asr.completedAt - session.stoppedAt : null,
      stopToDeliveryMs: session.stoppedAt ? Date.now() - session.stoppedAt : null })
    return { id: session.id, transcript: result.text, refined, delivery, mode: input.mode, durationMs: input.durationMs, detectedLanguage: result.detectedLanguage, refinement, insertion, asr: session.asr }
  }
  private stopCountdown(): void { if (this.countdown) clearInterval(this.countdown); this.countdown = null }
}
function retryContext(context: AudioContextSnapshot | null, config: Pick<Settings, 'sendFocusedAppContext' | 'sendScreenContext'>): AudioContextSnapshot | null {
  if (!context || !config.sendFocusedAppContext) return null
  const secure = context.focusedInput?.isSecure === true
  return { ...context,
    focusedInput: secure && context.focusedInput ? { ...context.focusedInput, selectedText: null, valuePreview: null } : context.focusedInput,
    visibleText: config.sendScreenContext && !secure ? context.visibleText : null,
    screenContent: config.sendScreenContext && !secure ? context.screenContent : null }
}
function mergeFrames(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((sum, frame) => sum + frame.length, 0))
  let offset = 0
  for (const frame of frames) { out.set(frame, offset); offset += frame.length }
  return out
}
export const recordingMachine = new RecordingMachine()
export { AUDIO }
