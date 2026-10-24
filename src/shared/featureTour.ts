import { z } from 'zod'
import { refinementOutcomeSchema } from './refinement'

export const practiceTargetSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string().min(1), kind: z.literal('dictation'), mode: z.literal('voice_transcript'), destination: z.enum(['chat', 'email', 'notes', 'tasks']).optional() }),
  z.object({ id: z.string().min(1), kind: z.literal('translation'), mode: z.literal('translation') }),
  z.object({ id: z.string().min(1), kind: z.literal('rewrite'), mode: z.literal('ask_anything'), selectedText: z.string().max(20000) }),
  z.object({ id: z.string().min(1), kind: z.literal('question'), mode: z.literal('ask_anything'), selectedText: z.string().max(20000) })
])
export type PracticeTarget = z.infer<typeof practiceTargetSchema>
export type OwnedPracticeTarget = { ownerId: number; target: PracticeTarget }
export const practiceResultSchema = z.object({ targetId: z.string(), transcript: z.string(), text: z.string(), refinement: refinementOutcomeSchema.optional() })
export type PracticeResult = z.infer<typeof practiceResultSchema>

export const TOUR_FEATURES = ['dictate', 'translate', 'askAnything'] as const
export type TourFeature = typeof TOUR_FEATURES[number]
export type TourStep = { kind: 'intro' | 'shortcut' | 'languages' | 'done' } | { kind: 'example'; index: number }
export const TOUR_STEPS: Record<TourFeature, readonly TourStep[]> = {
  dictate: [{ kind: 'intro' }, { kind: 'shortcut' }, ...[0, 1, 2, 3].map(index => ({ kind: 'example', index } satisfies TourStep)), { kind: 'done' }],
  translate: [{ kind: 'intro' }, { kind: 'shortcut' }, { kind: 'languages' }, { kind: 'example', index: 0 }, { kind: 'done' }],
  askAnything: [{ kind: 'intro' }, { kind: 'shortcut' }, ...[0, 1, 2].map(index => ({ kind: 'example', index } satisfies TourStep)), { kind: 'done' }]
}
