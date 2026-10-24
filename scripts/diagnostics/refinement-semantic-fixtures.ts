import { tourExample } from '../../src/renderer/hub/components/featureTourContent'

type TextCriterion = { pattern: string; reason: string }
type SemanticFixture = {
  id: string
  transcript: string
  language: 'en' | 'zh'
  required: readonly TextCriterion[]
  forbidden: readonly TextCriterion[]
  ordering?: readonly { before: string; after: string; reason: string }[]
}

/** Public synthetic dictation only. Use with the real configured model; a canned reply cannot verify semantic quality. */
export const refinementSemanticFixtures = [
  {
    id: 'tour-spelling-english', language: 'en', transcript: tourExample('dictate', 1, false).prompt,
    required: [{ pattern: '\\bSara\\b', reason: 'apply the final recipient spelling' }, { pattern: '408[\\s().-]*123[\\s().-]*4567', reason: 'preserve the dictated phone number' }, { pattern: '\\bJack\\b', reason: 'preserve the sign-off name' }],
    forbidden: [{ pattern: '\\bSarah\\b', reason: 'replace the superseded name' }, { pattern: 'S\\s*[-–]\\s*A\\s*[-–]\\s*R\\s*[-–]\\s*A|without\\s+(?:an?\\s+)?H|(?:is\\s+)?spell(?:ed|ing)', reason: 'omit the spelling instruction from the delivered message' }]
  },
  {
    id: 'tour-spelling-chinese', language: 'zh', transcript: tourExample('dictate', 1, true).prompt,
    required: [{ pattern: '\\bSara\\b', reason: 'apply the final recipient spelling' }, { pattern: '408[\\s().-]*123[\\s().-]*4567', reason: 'preserve the dictated phone number' }, { pattern: '\\bJack\\b', reason: 'preserve the sign-off name' }],
    forbidden: [{ pattern: '\\bSarah\\b', reason: 'replace the superseded name' }, { pattern: 'S\\s*[-–]\\s*A\\s*[-–]\\s*R\\s*[-–]\\s*A|没有\\s*H|不带\\s*H|拼写', reason: 'omit the spelling instruction from the delivered message' }]
  },
  {
    id: 'unseen-spelling-correction', language: 'en', transcript: 'Hi John, the review is confirmed for Friday. Thanks, Lee. Jon is J-O-N, no H.',
    required: [{ pattern: '\\bJon\\b', reason: 'use the explicitly spelled recipient' }, { pattern: '\\bFriday\\b', reason: 'preserve the schedule' }, { pattern: '\\bLee\\b', reason: 'preserve the sign-off' }],
    forbidden: [{ pattern: '\\bJohn\\b|J\\s*[-–]\\s*O\\s*[-–]\\s*N|no\\s+H|spell(?:ed|ing)', reason: 'apply the correction without echoing its explanation' }]
  },
  {
    id: 'asr-spelling-chinese-compact', language: 'zh', transcript: '你好Sarah我的新电话号码是4081234567谢谢Jack哦对了SARA没有H',
    required: [{ pattern: '\\bSara\\b', reason: 'apply the spelling even when ASR omits spaces and punctuation' }, { pattern: '408[\\s().-]*123[\\s().-]*4567', reason: 'preserve the dictated phone number' }, { pattern: '\\bJack\\b', reason: 'preserve the sign-off' }],
    forbidden: [{ pattern: '\\bSarah\\b|没有\\s*H|不带\\s*H|哦对了', reason: 'remove the compact spelling aside and superseded recipient' }]
  },
  {
    id: 'asr-spelling-english-spaced-letters', language: 'en', transcript: 'Hi Sarah my new phone number is 4081234567 thanks Jack oh and Sara is S A R A without the H',
    required: [{ pattern: '\\bSara\\b', reason: 'apply the final spelling from unhyphenated letters' }, { pattern: '408[\\s().-]*123[\\s().-]*4567', reason: 'preserve the dictated phone number' }, { pattern: '\\bJack\\b', reason: 'preserve the sign-off' }],
    forbidden: [{ pattern: '\\bSarah\\b|\\bS\\s+A\\s+R\\s+A\\b|without\\s+(?:(?:an?|the)\\s+)?H|spell(?:ed|ing)', reason: 'remove the spelling aside instead of copying the letters' }]
  },
  {
    id: 'tour-final-time', language: 'zh', transcript: tourExample('dictate', 0, true).prompt,
    required: [{ pattern: '九点半|9[:：]30', reason: 'keep the final meeting time' }, { pattern: '站会', reason: 'preserve the subject' }],
    forbidden: [{ pattern: '不对|还是改到|呃|嗯', reason: 'omit the abandoned take and its correction narration' }]
  },
  {
    id: 'tour-final-order', language: 'zh', transcript: tourExample('dictate', 3, true).prompt,
    required: [{ pattern: '停车', reason: 'preserve the parking task' }, { pattern: '值机', reason: 'preserve check-in' }, { pattern: '登机箱', reason: 'keep the final luggage choice' }, { pattern: '两晚|2\\s*晚', reason: 'preserve the short-trip reason' }, { pattern: '便宜', reason: 'preserve the parking-priority reason' }],
    forbidden: [{ pattern: '大行李箱', reason: 'discard the superseded luggage choice' }],
    ordering: [{ before: '停车', after: '值机', reason: 'move parking before check-in as explicitly corrected' }, { before: '停车', after: '登机箱', reason: 'move parking before packing as explicitly corrected' }]
  },
  {
    id: 'quoted-spelling-content', language: 'en', transcript: 'In the transcript, the witness said, quote, Sara is spelled S-A-R-A, without an H, end quote. Keep that quotation in the report.',
    required: [{ pattern: 'S\\s*[-–]\\s*A\\s*[-–]\\s*R\\s*[-–]\\s*A', reason: 'preserve literal spelling inside the quoted source' }, { pattern: 'without\\s+(?:an?\\s+)?H', reason: 'preserve the quoted explanation' }, { pattern: 'witness', reason: 'preserve the reported context' }],
    forbidden: []
  },
  {
    id: 'spelling-explanation-is-content', language: 'zh', transcript: '老师解释说，Sara 的拼写是 S-A-R-A，没有 H。请把这个例子写在课堂笔记里。',
    required: [{ pattern: '老师', reason: 'preserve the teaching context' }, { pattern: 'S\\s*[-–]\\s*A\\s*[-–]\\s*R\\s*[-–]\\s*A', reason: 'preserve spelling that is the subject of the message' }, { pattern: '没有\\s*H|不带\\s*H', reason: 'preserve the explanation as message content' }],
    forbidden: []
  },
  {
    id: 'dictated-question-stays-question', language: 'en', transcript: 'Why is Sara spelled without an H in this document?',
    required: [{ pattern: '\\bWhy\\b', reason: 'keep the dictated question instead of answering it' }, { pattern: 'without\\s+(?:an?\\s+)?H', reason: 'retain spelling as the subject of the question' }, { pattern: 'document', reason: 'preserve the question context' }],
    forbidden: [{ pattern: '\\bbecause\\b', reason: 'do not answer a question in dictation mode' }]
  }
] satisfies readonly SemanticFixture[]

export function refinementSemanticFailures(fixture: SemanticFixture, output: string): string[] {
  const failures = fixture.required.filter(rule => !new RegExp(rule.pattern, 'iu').test(output)).map(rule => rule.reason)
  failures.push(...fixture.forbidden.filter(rule => new RegExp(rule.pattern, 'iu').test(output)).map(rule => rule.reason))
  for (const rule of fixture.ordering ?? []) {
    const before = output.search(new RegExp(rule.before, 'iu')), after = output.search(new RegExp(rule.after, 'iu'))
    if (before < 0 || after < 0 || before >= after) failures.push(rule.reason)
  }
  return output.trim() ? failures : ['return non-empty written text', ...failures]
}
