import type { RecorderHandle } from './audio'

export type RecorderState = {
  phase: string
  context: { sessionId: string | null; [key: string]: any }
}

type Dependencies = {
  settings: () => Promise<{ muteWhileDictating?: boolean; muteBackgroundAudio?: boolean; micDevice?: string | null }>
  isMuted: () => Promise<boolean>
  mute: () => Promise<unknown>
  unmute: () => Promise<unknown>
  status: (phase: string, payload: Record<string, unknown>) => Promise<unknown>
  start: (options: { deviceId?: string | null; onChunk: (pcm: Float32Array) => void; onLevel: (level: number) => void }) => Promise<RecorderHandle>
  onRecorder: (recorder: RecorderHandle | null) => void
}

type Session = {
  id: string
  cancelled: boolean
  stopping: boolean
  muted: boolean
  handle: RecorderHandle | null
  chunks: Promise<unknown>
  startup: Promise<void>
  cleanup: Promise<void> | null
}

/** Owns only the microphone. The main process owns the session and its result.
 * Every outgoing message is scoped to the session that produced it. */
export class RecorderSessionController {
  private active: Session | null = null
  private pendingCleanup: Promise<void> = Promise.resolve()
  private acknowledged = new Set<string>()

  constructor(private readonly deps: Dependencies) {}

  sync(state: RecorderState): void {
    const id = state.context?.sessionId
    if (state.phase === 'starting' && id) {
      if (this.active?.id === id) return
      this.cancel()
      const session: Session = {
        id, cancelled: false, stopping: false, muted: false, handle: null,
        chunks: Promise.resolve(), startup: Promise.resolve(), cleanup: null
      }
      const previous = this.pendingCleanup
      this.active = session
      session.startup = previous.then(() => this.open(session))
    } else if (state.phase === 'finishing' && id) {
      const session = this.active
      if (session?.id === id) {
        if (session.stopping) return
        session.stopping = true
        void this.stop(session).then(() => {
          if (!session.cancelled) return this.acknowledge(id)
        })
      } else {
        // A renderer reload can first observe finishing, with no microphone.
        void this.acknowledge(id)
      }
    } else if (state.phase === 'idle' || state.phase === 'error') {
      this.cancel()
    }
  }

  private async open(session: Session): Promise<void> {
    try {
      if (session.cancelled || session.stopping) return
      const config = await this.deps.settings()
      if (session.cancelled || session.stopping) return
      if ((config.muteWhileDictating ?? config.muteBackgroundAudio) !== false) {
        const alreadyMuted = await this.deps.isMuted()
        if (session.cancelled || session.stopping) return
        if (!alreadyMuted) {
          await this.deps.mute()
          session.muted = true
        }
      }
      if (session.cancelled || session.stopping) return
      session.handle = await this.deps.start({
        deviceId: config.micDevice ?? null,
        onChunk: (pcm) => {
          if (session.cancelled) return
          // Preserve the tail: stopped is sent only after every chunk IPC settles.
          session.chunks = session.chunks.then(() => this.deps.status('chunk', { sessionId: session.id, pcm: pcm.buffer }))
          // Observe immediately to avoid an unhandled rejection before stop.
          void session.chunks.catch(() => undefined)
        },
        onLevel: () => undefined
      })
      if (session.cancelled || session.stopping) return
      this.deps.onRecorder(session.handle)
      await this.deps.status('started', { sessionId: session.id })
    } catch (error) {
      if (!session.cancelled && !session.stopping) {
        await this.deps.status('error', { sessionId: session.id, error: error instanceof Error ? error.message : String(error) }).catch(() => undefined)
        // Schedule outside startup so cleanup never waits on itself.
        queueMicrotask(() => { if (this.active === session) this.cancel() })
      }
    }
  }

  private stop(session: Session): Promise<void> {
    if (session.cleanup) return session.cleanup
    session.cleanup = (async () => {
      await session.startup
      const handle = session.handle
      session.handle = null
      try {
        await handle?.stop()
        await session.chunks
      } catch (error) {
        if (!session.cancelled) {
          session.cancelled = true
          await this.deps.status('error', { sessionId: session.id, error: error instanceof Error ? error.message : String(error) }).catch(() => undefined)
        }
      } finally {
        if (this.active === session) this.deps.onRecorder(null)
        if (session.muted) {
          session.muted = false
          await this.deps.unmute().catch(() => undefined)
        }
      }
    })()
    this.pendingCleanup = session.cleanup
    return session.cleanup
  }

  private async acknowledge(id: string): Promise<void> {
    if (this.acknowledged.has(id)) return
    this.acknowledged.add(id)
    // Keep memory bounded during long-running desktop sessions.
    if (this.acknowledged.size > 32) this.acknowledged.delete(this.acknowledged.values().next().value!)
    await this.deps.status('stopped', { sessionId: id }).catch(() => undefined)
  }

  cancel(): void {
    const session = this.active
    if (!session) return
    session.cancelled = true
    this.active = null
    this.deps.onRecorder(null)
    void this.stop(session)
  }

  async dispose(): Promise<void> {
    this.cancel()
    await this.pendingCleanup
  }
}
