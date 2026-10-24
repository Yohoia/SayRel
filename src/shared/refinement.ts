import { z } from 'zod'

export const refinementOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('completed') }),
  z.object({ kind: z.literal('skipped') }),
  z.object({ kind: z.literal('fallback'), message: z.string() })
])
export type RefinementOutcome = z.infer<typeof refinementOutcomeSchema>

const voiceMetadataSchema = z.object({
  transcript: z.string(),
  detectedLanguage: z.string().nullable().optional(),
  refinement: refinementOutcomeSchema.optional()
})

export function readVoiceMetadata(json: string | null): z.infer<typeof voiceMetadataSchema> | null {
  if (!json) return null
  try {
    const parsed = voiceMetadataSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch { return null }
}
