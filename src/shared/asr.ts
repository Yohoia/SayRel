import { z } from 'zod'

const identity = {
  sessionId: z.string(), requestId: z.string(), providerId: z.string(), model: z.string(),
  path: z.enum(['live', 'batch', 'batch-fallback', 'saved']),
  startedAt: z.number(), completedAt: z.number(),
  connectionReadyAt: z.number().optional(), firstPartialAt: z.number().optional(), stoppedAt: z.number().optional(),
  streamFailure: z.string().optional()
}

export const asrOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ ...identity, kind: z.literal('final'), asrText: z.string().min(1), detectedLanguage: z.string().nullable(), confidence: z.number().nullable().optional() }),
  z.object({ ...identity, kind: z.literal('empty'), asrText: z.literal('') }),
  z.object({ ...identity, kind: z.literal('failed'), reason: z.enum(['timeout', 'network', 'provider', 'cancelled']), message: z.string() })
])

export type AsrOutcome = z.infer<typeof asrOutcomeSchema>
export type AsrFinal = Extract<AsrOutcome, { kind: 'final' }>
export type AsrPartial = { sessionId: string; requestId: string; text: string }
