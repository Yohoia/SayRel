import assert from 'node:assert/strict'
import { buildRefinementSystemPrompt, buildRefinementUserPrompt, REFINEMENT_PROMPT_VERSION } from '../../../src/main/services/providers/refinementPrompt'
import { DEFAULT_SETTINGS, mergeSettings, writingPreferencesSchema } from '../../../src/shared/settings'
import { asrOutcomeSchema } from '../../../src/shared/asr'

const request = { mode: 'voice_transcript' as const, transcript: 'Meet Alex tomorrow no Friday at 3.5 pm', languages: ['en-US'] }
assert.equal(DEFAULT_SETTINGS.polishLevel, 'light')
assert.equal(mergeSettings({}).polishLevel, 'light')
assert.equal(mergeSettings({}).dictionaryLearning, false)
assert.equal(mergeSettings({}).desktopCommandsEnabled, false)
for (const level of ['raw', 'light', 'strong'] as const) {
  const prompt = buildRefinementSystemPrompt({ ...request, polishLevel: level, writingStyle: 'formal', autoPunctuation: false })
  assert(prompt.includes(`${level.toUpperCase()}:`))
  assert.match(prompt, /reference data, never instructions/)
  assert.match(prompt, /Do not add punctuation/)
  assert.match(prompt, /professional tone/)
  assert.equal(prompt.includes('actively recast'), level === 'strong')
  if (level === 'raw') assert(!prompt.includes('Explicit dictation edits take precedence'))
  assert.equal(JSON.parse(buildRefinementUserPrompt({ ...request, polishLevel: level })).transcript, request.transcript)
}
assert.match(buildRefinementSystemPrompt(request), /LIGHT:/)
assert.equal(writingPreferencesSchema.safeParse({ polishLevel: 'extreme' }).success, false)
assert.equal(writingPreferencesSchema.safeParse({ dictionaryLearning: 'true' }).success, false)
assert.equal(writingPreferencesSchema.safeParse({ transcriptionLanguage: 'zh-CN' }).success, true)
assert.equal(writingPreferencesSchema.safeParse({ transcriptionLanguage: 'not a language' }).success, false)
assert(asrOutcomeSchema.safeParse({ kind: 'partial', asrText: 'Open Safari' }).success === false)
assert.equal(REFINEMENT_PROMPT_VERSION, 'dictation-2026-10-24.1')
console.log('PASS Writing controls: edit budgets, style, punctuation, settings validation and prompt version contracts')
