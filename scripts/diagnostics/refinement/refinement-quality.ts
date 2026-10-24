import assert from 'node:assert/strict'
import { fixtureGroups, gradeRefinementQuality, refinementQualityFailures, refinementQualityFixtures } from './refinement-quality-fixtures'

const ids = refinementQualityFixtures.map(fixture => fixture.id)
assert.equal(ids.length, new Set(ids).size, 'quality case IDs must be unique')
assert.equal(fixtureGroups.reduce((total, group) => total + group.fixtures.length, 0), ids.length, 'groups cover every case exactly once')
for (const fixture of refinementQualityFixtures) {
  assert.equal(fixture.request.mode, 'voice_transcript', `${fixture.id}: run the actual dictation mode, not question-answering mode`)
  assert.deepEqual(refinementQualityFailures(fixture, fixture.example), [], `${fixture.id}: the human-written example must satisfy the minimum contract`)
  assert(refinementQualityFailures(fixture, '').length > 0, `${fixture.id}: never accept a missing answer`)
  assert(refinementQualityFailures(fixture, fixture.weakExample.output).length > 0, `${fixture.id}: detect the described regression: ${fixture.weakExample.reason}`)
  assert.equal(gradeRefinementQuality(fixture, fixture.example).status, 'needs-human-review', `${fixture.id}: regex success is not evidence of fluent writing`)
  assert.equal(gradeRefinementQuality(fixture, fixture.weakExample.output).status, 'failed')
}

const todo = refinementQualityFixtures.find(fixture => fixture.id === 'tour-todo-zh-actionable-not-narrated')
assert(todo)
assert.deepEqual(refinementQualityFailures(todo, todo.example.replace('1. 预订', '1. 先预订')), [], 'ordinary task prefixes remain valid when actions and compact reasons are correct')
assert.deepEqual(refinementQualityFailures(todo, todo.example.replace('1. 预订', '1. 优先预订')), [], 'priority can be stated naturally without becoming conversational narration')

process.stdout.write(`Refinement quality grader: ${ids.length} public cases validated; this tests the evaluator only. Real-provider output and human review are required to assess writing quality.\n`)
