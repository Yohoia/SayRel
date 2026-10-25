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
const reportedParentheticalOutput = '周五之前：\n1. 预订机场停车位（便宜的位置很快就没有了）。\n2. 网上值机。\n3. 收拾登机箱（只住两晚，够用）。'
assert(refinementQualityFailures(todo, reportedParentheticalOutput).includes('未要求括注时，不主动添加括号说明'), 'reject the exact unsolicited-parentheses output reported by the user')
assert.deepEqual(refinementQualityFailures(todo, todo.example.replace('1. 优先预订', '1. 先预订')), [], 'ordinary task prefixes remain valid when actions and compact reasons are correct')
assert.deepEqual(refinementQualityFailures(todo, todo.example.replace('1. 优先预订', '1. 预订')), [], 'priority can be stated naturally without becoming conversational narration')

for (const variation of [
  { id: 'zh-repair-stutter-and-syntax', from: '下午三点', to: '下午 3 点' },
  { id: 'zh-apply-chained-corrections', from: '上午十点', to: '上午 10 点' },
  { id: 'zh-repair-unambiguous-asr-word', from: '下午两点', to: '下午 2 点' },
  { id: 'zh-repair-unambiguous-asr-word', from: '五分钟', to: '5 分钟' }
]) {
  const fixture = refinementQualityFixtures.find(fixture => fixture.id === variation.id)
  assert(fixture)
  assert(fixture.example.includes(variation.from))
  assert.deepEqual(refinementQualityFailures(fixture, fixture.example.replace(variation.from, variation.to)), [], `${fixture.id}: equivalent numeric typography is not lost information`)
  const wrongValue = variation.to.replace(/\d/, digit => String(Number(digit) + 1))
  assert(refinementQualityFailures(fixture, fixture.example.replace(variation.from, wrongValue)).length > 0, `${fixture.id}: a changed numeric value still fails`)
}
assert(refinementQualityFailures(todo, todo.example.replace('机场', '')).includes('保留停车地点为机场'), 'the evaluator must catch loss of the airport location')

process.stdout.write(`Refinement quality grader: ${ids.length} public cases validated; this tests the evaluator only. Real-provider output and human review are required to assess writing quality.\n`)
