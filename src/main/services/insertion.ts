import { clipboard } from 'electron'
import { input } from '../lib/native'
import { createLogger } from '../lib/logger'
import { ensureTrailingSpace } from './providers/postprocess'

const log = createLogger('insertion')

export type InsertOutcome = {
  method: 'native' | 'clipboard'
  ok: boolean
  error?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Inserts text into whatever app currently has focus.
 *
 * The native helper owns the pasteboard save/restore dance; when it is not
 * available (or accessibility is not granted) we fall back to putting the text
 * on the clipboard and telling the UI to prompt for a manual paste.
 */
export async function insertText(
  text: string,
  opts: { addTrailingSpace?: boolean; retries?: number; isCancelled?: () => boolean } = {}
): Promise<InsertOutcome> {
  const payload = ensureTrailingSpace(text, opts.addTrailingSpace ?? true)
  if (!payload) return { method: 'native', ok: true }

  const retries = opts.retries ?? 2
  if (input.available && input.insertText) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (opts.isCancelled?.()) return { method: 'native', ok: false, error: 'cancelled' }
      try {
        const code = input.insertText(payload)
        if (code === 0) return { method: 'native', ok: true }
        log.warn(`insertText returned ${code} (attempt ${attempt + 1})`)
      } catch (err: any) {
        log.error('insertText threw', err)
      }
      await sleep(120)
    }
  }

  if (opts.isCancelled?.()) return { method: 'clipboard', ok: false, error: 'cancelled' }
  clipboard.writeText(payload)
  return { method: 'clipboard', ok: false, error: 'native-insert-unavailable' }
}

export async function insertRichText(html: string, text: string): Promise<InsertOutcome> {
  if (input.available && input.insertRichText) {
    try {
      const code = input.insertRichText(html, text)
      if (code === 0) return { method: 'native', ok: true }
    } catch (err) {
      log.error('insertRichText threw', err)
    }
  }
  clipboard.writeText(text)
  return { method: 'clipboard', ok: false, error: 'native-insert-unavailable' }
}

export async function deleteBackward(count: number): Promise<void> {
  if (input.available && input.deleteBackward) {
    input.deleteBackward(count)
  }
}

export async function readSelectedText(timeoutMs = 400): Promise<string | null> {
  if (!input.available || !input.getSelectedText) return null
  try {
    return input.getSelectedText(timeoutMs) || null
  } catch {
    return null
  }
}

export function readInputState(timeoutMs = 400): Record<string, unknown> | null {
  if (!input.available || !input.getCurrentInputState) return null
  try {
    const raw = input.getCurrentInputState(timeoutMs)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
