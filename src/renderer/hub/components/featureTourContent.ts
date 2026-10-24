import type { PracticeTarget, TourFeature } from '../../../shared/featureTour'
import type { ShortcutKey } from '../../../shared/settingsControls'

export const TOUR_CONTENT = {
  dictate: { title: 'Dictate', descriptionKey: 'hub__home__v2__shortcut__dictate__description', shortcut: 'shortcut', image: 'DQ3HOKjV', mode: 'voice_transcript' },
  translate: { title: 'Translate', descriptionKey: 'hub__home__v2__shortcut__translate__description', shortcut: 'translationShortcut', image: 'BaCQGXrG', mode: 'translation' },
  askAnything: { title: 'Ask anything', descriptionKey: 'hub__home__v2__shortcut__ask_anything__description', shortcut: 'askAnythingShortcut', image: 'Cdyl7_Hz', mode: 'ask_anything' }
} satisfies Record<TourFeature, { title: string; descriptionKey: import('../../../shared/interfaceText').SettingsTextKey; shortcut: ShortcutKey; image: string; mode: PracticeTarget['mode'] }>

const messages = {
  dictate: [
    ['Um, hey, can we, like, move the standup to 9? Uh, actually no, 9 doesn’t really work for me, so, yeah, let’s just do 9:30.', '嗯，我们能把站会改到九点吗？呃，不对，九点我不太方便，还是改到九点半吧。'],
    ['Hi Sarah, just wanted to let you know that my new phone number is 4081234567. Thanks, Jack. Oh, and Sara is spelled S-A-R-A, without an H.', '你好，Sarah，我的新电话号码是 4081234567。谢谢，Jack。哦，对了，Sara 的拼写是 S-A-R-A，没有 H。'],
    ['My reading list includes The Great Gatsby, um, I can’t remember the name, the first Harry Potter book, and Sapiens.', '我的阅读清单包括《了不起的盖茨比》，嗯，想不起名字了，哈利·波特的第一本，还有《人类简史》。'],
    ['Okay, a few things before Friday. First check in online, then pack the big suitcase, and book the airport parking. Actually, book the parking first, the cheap spots always go fast. Oh, and the suitcase, it’s only two nights, so the carry-on’s plenty.', '周五之前有几件事。先网上值机，再收拾大行李箱，然后预订机场停车位。等等，先订停车位，便宜的位置很快就没了。行李箱的话，只住两晚，带登机箱就够了。']
  ],
  translate: [["Here’s the product info, the price is 9 dollars, the size is 30, and we offer free returns.", '这是产品信息，价格是九美元，尺寸是三十，我们提供免费退货。']],
  askAnything: [
    ['Rewrite it into a viral Twitter post with a confident tone, emojis, and hashtags.', '把这段文字改写成一条自信、有吸引力的社交媒体帖子，加上表情和话题标签。'],
    ['Translate the selected text to English.', '把选中的文字翻译成中文。'],
    ['What’s the latest AI news today?', '今天有哪些值得关注的人工智能新闻？']
  ]
} satisfies Record<TourFeature, string[][]>

export function tourExample(feature: TourFeature, index: number, chinese: boolean) {
  const message = messages[feature][index] ?? messages[feature][0]
  const selectedText = feature !== 'askAnything' || index === 2 ? '' : index === 0
    ? chinese ? 'Sayrel 让你自然地说话，实时将语音转成得体的消息、邮件和文档，让表达像认真打字一样清晰。' : 'Sayrel lets you speak naturally and turns your words into polished messages, emails, and documents that read like you carefully typed them in real time.'
    : '日本一高くそびえる富士山は日本人にとって神聖な存在です。古くから「信仰の対象」として、日本人の自然観に大きな影響を与えてきました。'
  const features = feature === 'dictate' ? [
    ['removed the filler words', 'heard you change your mind: 9 → 9:30', 'kept only your final version'],
    ['formatted the email: greeting, body, sign-off', 'formatted the phone number for you', 'went back and fixed the name at the top'],
    ['turned your ramble into a numbered list', 'kept the book descriptions you provided', 'did not guess missing details'],
    ['moved parking to #1: you said it mattered most', 'kept your latest call: big suitcase → carry-on', 'kept your reasons: short notes in brackets']
  ][index] ?? [] : []
  return { prompt: message[chinese ? 1 : 0] ?? message[0], selectedText, features }
}

export function practiceTarget(feature: TourFeature, index: number, id: string, selectedText: string): PracticeTarget {
  if (feature === 'dictate') {
    const destinations = ['chat', 'email', 'notes', 'tasks'] satisfies NonNullable<Extract<PracticeTarget, { kind: 'dictation' }>['destination']>[]
    return { id, kind: 'dictation', mode: 'voice_transcript', destination: destinations[index] ?? 'chat' }
  }
  if (feature === 'translate') return { id, kind: 'translation', mode: 'translation' }
  return { id, kind: index === 0 ? 'rewrite' : 'question', mode: 'ask_anything', selectedText }
}
