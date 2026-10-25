import { z } from 'zod'
import { asrOutcomeSchema } from './asr'
import { insertionOutcomeSchema } from './insertion'

const writingDetails = {
  providerId: z.string().optional(), model: z.string().optional(), promptVersion: z.string().optional(),
  polishLevel: z.enum(['raw', 'light', 'strong']).optional(),
  writingStyle: z.enum(['neutral', 'formal', 'casual', 'concise']).optional(),
  autoPunctuation: z.boolean().optional()
}
export const refinementOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('completed'), ...writingDetails, changed: z.boolean().optional(), durationMs: z.number().optional() }),
  z.object({ kind: z.literal('skipped'), reason: z.literal('no-default-provider').optional() }),
  z.object({ kind: z.literal('fallback'), ...writingDetails, message: z.string() })
])
export type RefinementOutcome = z.infer<typeof refinementOutcomeSchema>

export function refinementStatusText(outcome?: RefinementOutcome): string | null {
  if (!outcome) return null
  switch (outcome.kind) {
    case 'completed': return outcome.changed === false ? 'Refinement completed without changes' : outcome.changed === true ? 'Text refined' : 'Refinement completed'
    case 'skipped': return outcome.reason === 'no-default-provider' ? 'Not refined: no writing model selected' : 'Refinement was skipped'
    case 'fallback': return 'Text refinement failed. Your original transcript is available.'
    default: { const exhaustive: never = outcome; return exhaustive }
  }
}

const voiceMetadataSchema = z.object({
  transcript: z.string(),
  detectedLanguage: z.string().nullable().optional(),
  refinement: refinementOutcomeSchema.optional(),
  asr: asrOutcomeSchema.optional(),
  insertion: insertionOutcomeSchema.optional()
})

export function readVoiceMetadata(json: string | null): z.infer<typeof voiceMetadataSchema> | null {
  if (!json) return null
  try {
    const parsed = voiceMetadataSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch { return null }
}
