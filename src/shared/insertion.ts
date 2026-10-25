import { z } from 'zod'
import type { Delivery } from './constants'

export const insertionOutcomeSchema = z.discriminatedUnion('verification', [
  z.object({ verification: z.literal('verified'), method: z.literal('native'), ok: z.literal(true) }),
  z.object({ verification: z.literal('not-needed'), method: z.literal('native'), ok: z.literal(true) }),
  z.object({ verification: z.literal('unknown'), method: z.literal('native'), ok: z.literal(false),
    error: z.enum(['target-changed', 'unreadable-input', 'text-mismatch', 'native-dispatch-error', 'cancelled']) }),
  z.object({ verification: z.literal('blocked'), method: z.literal('native'), ok: z.literal(false),
    error: z.enum(['secure-input', 'ime-composition']) }),
  z.object({ verification: z.literal('not-attempted'), method: z.enum(['native', 'clipboard']), ok: z.literal(false),
    error: z.enum(['cancelled', 'native-insert-unavailable', 'clipboard-unavailable']) })
])
export type InsertionOutcome = z.infer<typeof insertionOutcomeSchema>

export function insertionDelivery(outcome: InsertionOutcome): Delivery {
  if (outcome.ok) return 'insert'
  if (outcome.method === 'clipboard') return 'clipboard'
  if (outcome.verification === 'unknown' && outcome.error !== 'native-dispatch-error' && outcome.error !== 'cancelled') return 'unverified'
  return 'card'
}

export function insertionStatusText(outcome?: InsertionOutcome): string | null {
  if (outcome?.verification === 'unknown') return 'Insertion could not be verified. Check the target before copying to avoid duplicate text.'
  if (outcome?.verification === 'blocked') return 'Automatic insertion was blocked by secure input or active text composition. Copy the result when ready.'
  if (outcome?.verification === 'not-attempted' && outcome.error !== 'cancelled') return outcome.method === 'clipboard'
    ? 'Text is on the clipboard. Paste it manually.' : 'Automatic insertion is unavailable. Copy the result when ready.'
  return null
}
