import { z } from 'zod'

export const dictationUsageSchema = z.object({
  dictationCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  words: z.number().int().nonnegative(),
  wordsPerMinute: z.number().int().nonnegative().nullable(),
  savedTimeMs: z.number().nonnegative()
})
export type DictationUsage = z.infer<typeof dictationUsageSchema>

const segmenter = new Intl.Segmenter('en', { granularity: 'word' })
const cjkCharacter = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu

export function buildDictationUsage(records: Iterable<{ refinedText: string | null; duration: number | null }>): DictationUsage {
  let dictationCount = 0, durationMs = 0, words = 0, timedWords = 0, typingTimeMs = 0
  for (const record of records) {
    const text = record.refinedText ?? ''
    const characters = text.match(cjkCharacter)?.length ?? 0
    const otherWords = Array.from(segmenter.segment(text.replace(cjkCharacter, ' '))).filter(part => part.isWordLike).length
    const units = characters + otherWords
    dictationCount++
    words += units
    if (record.duration === null || !Number.isFinite(record.duration) || record.duration <= 0) continue
    durationMs += record.duration
    timedWords += units
    // Product estimate: 120 CJK characters/minute and 40 other words/minute.
    typingTimeMs += (characters / 120 + otherWords / 40) * 60000
  }
  return {
    dictationCount, durationMs, words,
    wordsPerMinute: durationMs > 0 ? Math.round(timedWords * 60000 / durationMs) : null,
    savedTimeMs: Math.max(0, typingTimeMs - durationMs)
  }
}
