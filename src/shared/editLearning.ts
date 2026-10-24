import { z } from 'zod'
import { diffWordsWithSpace } from 'diff'

export const inputSnapshotSchema = z.object({
  targetId: z.string(), hasFocus: z.literal(true), secureInput: z.literal(false),
  value: z.string().max(12000), caretLocation: z.number().int().nonnegative(),
  selectionLength: z.number().int().nonnegative(), hasMarkedText: z.literal(false)
}).refine(value => value.caretLocation + value.selectionLength <= value.value.length)
export type InputSnapshot = z.infer<typeof inputSnapshotSchema>

export const wordSuggestionSchema = z.object({ id: z.string(), requestId: z.string(), word: z.string().min(2).max(60), createdAt: z.number() })
export type WordSuggestion = z.infer<typeof wordSuggestionSchema>

export function dictatedRegion(before: InputSnapshot, after: InputSnapshot): string | null {
  if (before.targetId !== after.targetId || after.hasMarkedText || after.secureInput) return null
  const prefix = before.value.slice(0, before.caretLocation)
  const suffix = before.value.slice(before.caretLocation + before.selectionLength)
  if (!after.value.startsWith(prefix) || !after.value.endsWith(suffix) || after.value.length < prefix.length + suffix.length) return null
  const text = after.value.slice(prefix.length, suffix ? -suffix.length : undefined).trim()
  return text.length > 0 && text.length <= 1000 ? text : null
}

/** Suggest short replacements only; composing new sentences is not dictionary learning. */
export function correctedWords(inserted: string, edited: string): string[] {
  const before = inserted.trim(), after = edited.trim()
  if (!before || before === after || before.length > 1000 || after.length > 1000 || after.length < before.length * 0.5 || after.length > before.length * 2) return []
  const changes = diffWordsWithSpace(before, after)
  const unchanged = changes.filter(change => !change.added && !change.removed).reduce((sum, change) => sum + change.value.length, 0)
  if (unchanged < Math.max(before.length, after.length) * 0.6) return []
  const candidates: string[] = []
  for (let index = 0; index < changes.length - 1; index++) {
    const old = changes[index], replacement = changes[index + 1]
    if (!old.removed || !replacement.added) continue
    const word = replacement.value.trim(), removed = old.value.trim()
    if (!removed || removed.length > 60 || word.length < 2 || word.length > 60 || /[\d\n\r@:/\\]/.test(word)) continue
    if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]*[\p{L}\p{M}]$/u.test(word) || word.split(/\s+/).length > 3) continue
    if (word.toLocaleLowerCase() === removed.toLocaleLowerCase()) continue
    // Chinese replacements are short terms; long clauses need explicit manual addition.
    if (/\p{Script=Han}/u.test(word) && word.length > 8) continue
    candidates.push(word)
  }
  return [...new Set(candidates)].slice(0, 5)
}
