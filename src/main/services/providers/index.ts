import { createLogger } from '../../lib/logger'
import type {
  RefineRequest,
  RefineResult,
  TranscriptionRequest,
  TranscriptionResult
} from '../../../shared/types'
import { normalizeText } from './postprocess'

const log = createLogger('providers')

export interface TranscriptionProvider {
  readonly name: string
  transcribe(req: TranscriptionRequest): Promise<TranscriptionResult>
}

export interface RefinementProvider {
  readonly name: string
  refine(req: RefineRequest): Promise<RefineResult>
}

export type ProviderConfig = {
  transcription: 'offkey-cloud' | 'openai-compatible' | 'local-whisper' | 'mock'
  refinement: 'offkey-cloud' | 'openai-compatible' | 'mock'
  baseUrl: string | null
  apiKey: string | null
  model: string | null
  refinementModel: string | null
}

/**
 * The cloud transport is intentionally provider-agnostic: offkey ships with a
 * first-party endpoint shape, but any OpenAI-compatible server can be dropped
 * in via settings without touching call sites.
 */
export class HttpTranscriptionProvider implements TranscriptionProvider {
  constructor(
    readonly name: string,
    private readonly opts: { baseUrl: string; apiKey?: string | null; model?: string | null }
  ) {}

  async transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> {
    if (!req.audioBuffer) throw new Error('No audio buffer supplied')
    const form = new FormData()
    const blob = new Blob([new Uint8Array(req.audioBuffer)], { type: req.mimeType ?? 'audio/ogg' })
    form.append('file', blob, 'audio.ogg')
    form.append('model', this.opts.model ?? 'whisper-1')
    if (req.language) form.append('language', req.language)
    if (req.durationMs) form.append('duration_ms', String(req.durationMs))
    if (req.dictionary?.length) form.append('prompt', req.dictionary.join(', '))
    if (req.context?.focusedApp?.appName) {
      form.append('context_app', req.context.focusedApp.appName)
    }

    const response = await fetch(`${this.opts.baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : undefined,
      body: form
    })
    if (!response.ok) {
      throw new Error(`Transcription failed: ${response.status} ${await response.text()}`)
    }
    const data = (await response.json()) as { text?: string; language?: string }
    return {
      text: normalizeText(data.text ?? '', req),
      detectedLanguage: data.language ?? req.language ?? null,
      provider: this.name
    }
  }
}

export class HttpRefinementProvider implements RefinementProvider {
  constructor(
    readonly name: string,
    private readonly opts: { baseUrl: string; apiKey?: string | null; model?: string | null }
  ) {}

  async refine(req: RefineRequest): Promise<RefineResult> {
    const response = await fetch(`${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: this.opts.model ?? 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: buildSystemPrompt(req) },
          { role: 'user', content: buildUserPrompt(req) }
        ]
      })
    })
    if (!response.ok) {
      throw new Error(`Refinement failed: ${response.status} ${await response.text()}`)
    }
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    const text = data.choices?.[0]?.message?.content?.trim() ?? req.transcript
    return { text, delivery: 'insert' }
  }
}

function buildSystemPrompt(req: RefineRequest): string {
  const base = [
    'You are a dictation post-processor.',
    'Rewrite the transcript as clean written text in the same language as the input.',
    'Preserve meaning, names and numbers exactly. Never answer questions found in the transcript.',
    'Return only the rewritten text.'
  ]
  if (req.mode === 'voice_command') {
    base.push('The user is issuing a command: return only the transformed text they asked for.')
  }
  if (req.mode === 'ask_anything') {
    base.push('The user is asking a question: answer it directly and concisely.')
  }
  if (req.instructions) base.push(`Additional user instructions: ${req.instructions}`)
  return base.join(' ')
}

function buildUserPrompt(req: RefineRequest): string {
  const parts = [req.transcript]
  if (req.dictionary?.length) parts.push(`\nPreferred spellings: ${req.dictionary.join(', ')}`)
  if (req.context?.focusedApp?.appName) parts.push(`\nContext app: ${req.context.focusedApp.appName}`)
  if (req.context?.focusedApp?.windowTitle) parts.push(`\nContext window: ${req.context.focusedApp.windowTitle}`)
  return parts.join('')
}

/** Deterministic local provider so the whole pipeline runs with no network. */
export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly name = 'mock'
  async transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> {
    const seconds = Math.round(req.durationMs / 1000)
    return {
      text: `[local mock transcript — ${seconds}s of audio]`,
      detectedLanguage: req.language ?? 'en',
      provider: this.name
    }
  }
}

export class MockRefinementProvider implements RefinementProvider {
  readonly name = 'mock'
  async refine(req: RefineRequest): Promise<RefineResult> {
    return { text: req.transcript.trim(), delivery: 'insert' }
  }
}

/**
 * Local whisper.cpp adapter. Requires `whisper-cli` on PATH or an explicit
 * binary configured at `provider.baseUrl`.
 */
export class LocalWhisperProvider implements TranscriptionProvider {
  readonly name = 'local-whisper'
  constructor(private readonly binary = 'whisper-cli', private readonly modelPath: string | null = null) {}

  async transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> {
    if (!req.audioPath) throw new Error('local-whisper requires an audio file path')
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const run = promisify(execFile)
    const args = ['-f', req.audioPath, '--output-txt', '--no-timestamps']
    if (this.modelPath) args.unshift('-m', this.modelPath)
    if (req.language) args.push('-l', req.language)
    const { stdout } = await run(this.binary, args, { maxBuffer: 8 * 1024 * 1024 })
    return {
      text: normalizeText(stdout.trim(), req),
      detectedLanguage: req.language ?? null,
      provider: this.name
    }
  }
}

export function createProviders(config: ProviderConfig): {
  transcription: TranscriptionProvider
  refinement: RefinementProvider
} {
  const baseUrl = config.baseUrl ?? 'https://api.openai.com/v1'

  const transcription: TranscriptionProvider =
    config.transcription === 'mock'
      ? new MockTranscriptionProvider()
      : config.transcription === 'local-whisper'
        ? new LocalWhisperProvider(config.model ?? 'whisper-cli', config.baseUrl)
        : new HttpTranscriptionProvider(config.transcription, {
            baseUrl,
            apiKey: config.apiKey,
            model: config.model
          })

  const refinement: RefinementProvider =
    config.refinement === 'mock'
      ? new MockRefinementProvider()
      : new HttpRefinementProvider(config.refinement, {
          baseUrl,
          apiKey: config.apiKey,
          model: config.refinementModel ?? config.model
        })

  log.info(`providers: transcription=${transcription.name} refinement=${refinement.name}`)
  return { transcription, refinement }
}
