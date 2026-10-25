import { clipboard } from 'electron'
import { input } from '../lib/native'
import { createLogger } from '../lib/logger'
import { ensureTrailingSpace } from './providers/postprocess'
import { z } from 'zod'
import { inputSnapshotSchema } from '../../shared/editLearning'
import type { InsertionOutcome } from '../../shared/insertion'

const log = createLogger('insertion')

export type InsertOutcome = InsertionOutcome

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const safetySchema = z.object({ secureInput: z.boolean().optional(), hasMarkedText: z.boolean().optional() })

async function deliverText(payload: string, dispatch: (() => number) | null, isCancelled: () => boolean): Promise<InsertOutcome> {
  if (isCancelled()) return { method: 'native', ok: false, verification: 'not-attempted', error: 'cancelled' }
  if (!payload) return { method: 'native', ok: true, verification: 'not-needed' }
  const raw = readInputState(80)
  const safety = safetySchema.safeParse(raw)
  if (safety.success && (safety.data.secureInput || safety.data.hasMarkedText)) return {
    method: 'native', ok: false, verification: 'blocked', error: safety.data.secureInput ? 'secure-input' : 'ime-composition'
  }
  const before = inputSnapshotSchema.safeParse(raw)
  if (isCancelled()) return { method: 'native', ok: false, verification: 'not-attempted', error: 'cancelled' }
  if (input.available && dispatch) {
    let code: number
    try { code = dispatch() }
    catch {
      log.warn('Native insertion dispatch failed; not retrying an uncertain paste')
      return { method: 'native', ok: false, verification: 'unknown', error: 'native-dispatch-error' }
    }
    if (code === -3 || code === -4) return { method: 'native', ok: false, verification: 'blocked', error: code === -3 ? 'secure-input' : 'ime-composition' }
    // -2 means no event was dispatched. Other uncertain returns must not trigger another paste.
    if (code !== -2) {
      if (isCancelled()) return { method: 'native', ok: false, verification: 'unknown', error: 'cancelled' }
      if (!before.success) return { method: 'native', ok: false, verification: 'unknown', error: 'unreadable-input' }
      const expected = before.data.value.slice(0, before.data.caretLocation) + payload
        + before.data.value.slice(before.data.caretLocation + before.data.selectionLength)
      const deadline = Date.now() + 400
      do {
        if (isCancelled()) return { method: 'native', ok: false, verification: 'unknown', error: 'cancelled' }
        const after = inputSnapshotSchema.safeParse(readInputState(80))
        if (!after.success) return { method: 'native', ok: false, verification: 'unknown', error: 'unreadable-input' }
        if (after.data.targetId !== before.data.targetId) return { method: 'native', ok: false, verification: 'unknown', error: 'target-changed' }
        if (after.data.value === expected) return { method: 'native', ok: true, verification: 'verified' }
        await sleep(40)
      } while (Date.now() < deadline)
      if (isCancelled()) return { method: 'native', ok: false, verification: 'unknown', error: 'cancelled' }
      return { method: 'native', ok: false, verification: 'unknown', error: 'text-mismatch' }
    }
  }
  if (isCancelled()) return { method: 'native', ok: false, verification: 'not-attempted', error: 'cancelled' }
  try {
    clipboard.writeText(payload)
    return { method: 'clipboard', ok: false, verification: 'not-attempted', error: 'native-insert-unavailable' }
  } catch {
    return { method: 'native', ok: false, verification: 'not-attempted', error: 'clipboard-unavailable' }
  }
}

export async function insertText(
  text: string,
  opts: { addTrailingSpace?: boolean; isCancelled?: () => boolean } = {}
): Promise<InsertOutcome> {
  const payload = ensureTrailingSpace(text, opts.addTrailingSpace ?? true)
  const insert = input.insertText
  return deliverText(payload, insert ? () => insert(payload) : null, opts.isCancelled ?? (() => false))
}

export async function insertRichText(html: string, text: string): Promise<InsertOutcome> {
  const insert = input.insertRichText
  return deliverText(text, insert ? () => insert(html, text) : null, () => false)
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
