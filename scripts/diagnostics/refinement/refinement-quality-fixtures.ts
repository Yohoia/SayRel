import type { RefineRequest } from '../../../src/shared/types'
import { tourExample } from '../../../src/renderer/hub/components/featureTourContent'

type TextRule = { pattern: string; reason: string }
type OrderedRule = { before: string; after: string; reason: string }
type QualityFixture = {
  id: string
  group: 'readability' | 'editing' | 'preservation'
  request: Pick<RefineRequest, 'transcript' | 'mode' | 'languages' | 'polishLevel'>
  example: string
  required: readonly TextRule[]
  forbidden: readonly TextRule[]
  ordering?: readonly OrderedRule[]
  review: readonly string[]
  weakExample: { output: string; reason: string }
}

/**
 * Public synthetic dictation, with examples written from the intended message rather than model output.
 * Pattern checks establish a minimum contract, not a score for fluent prose. A real-model run must
 * retain outputs for a human to review against `example` and `review`; no mocked reply proves quality.
 */
export const refinementQualityFixtures = [
  {
    id: 'tour-todo-zh-actionable-not-narrated', group: 'readability',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['zh-CN'], transcript: tourExample('dictate', 3, true).prompt },
    example: '周五前的待办事项：\n1. 预订机场停车位（便宜的车位容易订满）。\n2. 网上值机。\n3. 收拾登机箱（只住两晚，登机箱足够）。',
    required: [
      { pattern: '(?:^|\\n)\\s*(?:[-*•]|\\d+[.、)])\\s*(?:先|优先|首先)?\\s*(?:预订|预定|订|预约).*停车', reason: '停车应是实际清单中的动作条目' },
      { pattern: '(?:^|\\n)\\s*(?:[-*•]|\\d+[.、)])\\s*(?:网上值机|在线值机|办理.*值机)', reason: '网上值机应是独立的动作条目' },
      { pattern: '(?:^|\\n)\\s*(?:[-*•]|\\d+[.、)])\\s*(?:收拾|准备|打包|整理|带上|携带|带).*登机箱', reason: '把“行李箱的话”整理为直接的登机箱待办事项' },
      { pattern: '周五', reason: '保留完成期限' }, { pattern: '便宜|低价', reason: '保留优先停车的价格理由' }, { pattern: '两晚|2\\s*晚', reason: '保留登机箱足够的行程理由' }
    ],
    forbidden: [
      { pattern: '大行李箱|等等|行李箱的话|几件事[。.]', reason: '删除废弃选择、改口叙述和会话式任务引入' },
      { pattern: '(?:便宜|低价)的?(?:位置|车位)[^。\\n）)]{0,10}(?:就没了|就没有了)|(?:带|用)(?:上|个|一个)?登机箱(?:就|已经)?够了', reason: '理由应压成简洁短注，不能把原话整句搬进括号' }
    ],
    ordering: [{ before: '停车', after: '值机', reason: '停车优先于值机' }, { before: '停车', after: '登机箱', reason: '停车优先于行李' }],
    review: ['必须是三个可以直接照做的简洁待办，而不是把原话切成三个编号段落。', '把便宜车位抢手、只住两晚两个理由压成条目后的短注，优先使用括号；不新增任务或因果。', '这是用户报告的真实引导页句子，逐项比较原话与输出，不能只因为出现停车、值机、登机箱就判好。'],
    weakExample: { output: '周五之前要办几件事：\n1. 预订机场停车位（便宜的位置很快就没了）。\n2. 网上值机。\n3. 收拾登机箱（只住两晚，带登机箱就够了）。', reason: '真实模型初版输出的名词、顺序、格式均对，但只是把原话套进括号，理由没有整理。' }
  },
  {
    id: 'tour-todo-en-actionable-not-narrated', group: 'readability',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['en'], transcript: tourExample('dictate', 3, false).prompt },
    example: 'Before Friday:\n1. Book airport parking (cheap spots go quickly).\n2. Check in online.\n3. Pack a carry-on (enough for two nights).',
    required: [
      { pattern: '(?:^|\\n)\\s*(?:[-*•]|\\d+[.)])\\s*(?:Book|Reserve|Arrange)\\b[^\\n]*parking', reason: 'render parking as an actionable list item' },
      { pattern: '(?:^|\\n)\\s*(?:[-*•]|\\d+[.)])\\s*(?:Check in|Complete[^\\n]*check-in)\\b[^\\n]*online|(?:^|\\n)\\s*(?:[-*•]|\\d+[.)])\\s*Check in online', reason: 'render online check-in as an actionable list item' },
      { pattern: '(?:^|\\n)\\s*(?:[-*•]|\\d+[.)])\\s*(?:Pack|Prepare|Take|Bring)\\b[^\\n]*carry[- ]on', reason: 'turn the suitcase narration into an actionable carry-on task' },
      { pattern: 'Friday', reason: 'retain the deadline' }, { pattern: 'cheap|inexpensive|low[- ]cost', reason: 'retain the price reason for prioritizing parking' }, { pattern: 'two nights|2 nights', reason: 'retain the short-trip reason' }
    ],
    forbidden: [{ pattern: 'big suitcase|Okay|Actually|Oh, and|the suitcase,|a few things|it[’\']s only', reason: 'remove abandoned choices and conversational narration from the task list' }],
    ordering: [{ before: 'parking', after: 'check[- ]?in|check in', reason: 'put parking before online check-in' }, { before: 'parking', after: 'carry[- ]on', reason: 'put parking before packing' }],
    review: ['All three items begin with an action; list formatting alone is insufficient.', 'Keep the cheap-parking and two-night reasons as concise task annotations, preferably in brackets.', 'Keep the final luggage choice and deadline without inventing a flight, hotel, booking URL or date.'],
    weakExample: { output: 'A few things before Friday:\n1. Book the airport parking first, the cheap spots always go fast.\n2. Check in online.\n3. The suitcase, it’s only two nights, so the carry-on’s plenty.', reason: 'A numbered transcript is still conversational narration rather than an organized to-do list.' }
  },
  {
    id: 'zh-repair-stutter-and-syntax', group: 'readability',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['zh-CN'], transcript: '呃那个这这份报告我我昨天已经看了然后就是有两处地方需要改一下一个是收入那里少了华南区另外一个是附录还用的是旧版本麻烦你今天下午三点前更新一下' },
    example: '这份报告我昨天已经看过，有两处需要修改：收入部分少了华南区，附录仍是旧版本。麻烦你今天下午三点前更新。',
    required: [{ pattern: '报告', reason: '保留报告主题' }, { pattern: '华南', reason: '保留缺失的区域' }, { pattern: '附录', reason: '保留附录问题' }, { pattern: '今天下午(?:三|3)点|今天(?:下午)?\\s*15[:：]00', reason: '保留当天 15:00 的截止时间' }],
    forbidden: [{ pattern: '这这|我我|呃|那个|然后就是', reason: '清理明显的口吃和无意义过渡词' }],
    review: ['读起来像直接发给同事的完整消息，修复口语语法，避免只给原文补标点。', '不把两个具体问题概括成“请完善报告”，不新增责任归属。'],
    weakExample: { output: '这这份报告我我昨天已经看了，然后就是有两处地方需要改一下。一个是收入那里少了华南区，另外一个是附录还用的是旧版本。麻烦你今天下午三点前更新一下。', reason: '仅补标点，没有清除口吃、赘词或整理句法。' }
  },
  {
    id: 'en-repair-spoken-grammar', group: 'readability',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['en'], transcript: 'um I has checked the invoice yesterday and the total are wrong because shipping got charged two times can you send me a corrected one before Friday please' },
    example: 'I checked the invoice yesterday, and the total is wrong because shipping was charged twice. Could you send me a corrected invoice before Friday, please?',
    required: [{ pattern: 'invoice', reason: 'retain the invoice topic' }, { pattern: 'shipping', reason: 'retain the duplicated charge' }, { pattern: 'twice|two times|double', reason: 'retain the reason the total is wrong' }, { pattern: 'before Friday', reason: 'retain the deadline' }],
    forbidden: [{ pattern: '\\bI has\\b|\\btotal are\\b|^\\s*um\\b', reason: 'repair obvious spoken grammar and remove the filler' }],
    review: ['Use natural written English without making the polite request aggressive or adding a refund demand.', 'Preserve that the invoice was already checked yesterday.'],
    weakExample: { output: 'I has checked the invoice yesterday, and the total are wrong because shipping got charged two times. Can you send me a corrected one before Friday, please?', reason: 'Punctuation alone leaves basic grammar mistakes in the delivered text.' }
  },
  {
    id: 'zh-apply-chained-corrections', group: 'editing',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['zh-CN'], transcript: '给陈经理发个消息说周三上午十点在二楼开会不对是周四上午十点地点不是二楼改成线上标题写项目复盘' },
    example: '陈经理，项目复盘会定于周四上午十点在线上举行。',
    required: [{ pattern: '陈经理', reason: '保留收件人' }, { pattern: '周四', reason: '应用最后确定的日期' }, { pattern: '上午(?:十|10)点|10[:：]00', reason: '保留未被修改的时间' }, { pattern: '线上', reason: '应用最后确定的地点' }, { pattern: '项目复盘', reason: '保留指定的会议主题' }],
    forbidden: [
      { pattern: '周三|二楼|不对|标题写|发个消息|不是.*改成|标题为', reason: '删除被替换的内容和编辑口令，实际应用标题而不叙述“标题为”' },
      { pattern: '您好|请知悉|请查收|敬请|此致|敬礼', reason: '不凭空增加寒暄、客套结语或提高正式程度' }
    ],
    review: ['输出可发送的消息，不能逐字保留“给某人发个消息说”，不凭空添加问候或结尾套话。', '标题可以单独一行，也可自然融入会议名称，不能丢掉主题或在正文反复叙述标题。'],
    weakExample: { output: '陈经理，您好！\n\n项目复盘会议定于周四上午10点线上进行，标题为“项目复盘”。\n\n请知悉。', reason: '真实模型初版应用了日期地点纠正，却增加未口述的套话并重复叙述标题。' }
  },
  {
    id: 'en-apply-spelling-and-ticket', group: 'editing',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['en'], transcript: 'Hi Catherine please check ticket AB dash zero zero seven by noon thanks Mei oh the name is Katherine with a K not a C and write the ticket with the dash' },
    example: 'Hi Katherine,\n\nPlease check ticket AB-007 by noon.\n\nThanks,\nMei',
    required: [{ pattern: '\\bKatherine\\b', reason: 'apply the corrected recipient spelling' }, { pattern: '\\bAB-007\\b', reason: 'apply the ticket formatting without losing leading zeros' }, { pattern: 'noon', reason: 'retain the deadline' }, { pattern: '\\bMei\\b', reason: 'retain the sign-off name' }],
    forbidden: [{ pattern: '\\bCatherine\\b|with a K|not a C|write the ticket|dash zero', reason: 'omit spelling and formatting asides after applying them' }],
    review: ['Render an ordinary readable message or email, with natural punctuation.', 'Do not replace the dictated identifier or invent a ticket link.'],
    weakExample: { output: 'Hi Katherine, please check ticket AB-007 by noon. Thanks, Mei. The name is Katherine with a K, not a C.', reason: 'Applies the spelling but also copies the spelling explanation.' }
  },
  {
    id: 'zh-apply-email-line-breaks', group: 'editing',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['zh-CN'], transcript: '王老师您好换一段附件是这次活动的预算总额两千八百元请您周五前确认是否可以执行换一段谢谢小林' },
    example: '王老师您好：\n\n附件是本次活动的预算，总额为 2800 元。请您在周五前确认是否可以执行。\n\n谢谢！\n小林',
    required: [{ pattern: '王老师', reason: '保留称呼' }, { pattern: '预算', reason: '保留邮件事项' }, { pattern: '2[,]?800|两千八百|二千八百', reason: '保留精确预算金额' }, { pattern: '周五前', reason: '保留确认期限' }, { pattern: '小林', reason: '保留署名' }, { pattern: '\\n', reason: '实际应用分段口令' }],
    forbidden: [{ pattern: '换一段|换行|新的一段', reason: '不把分段口令留在正文' }],
    review: ['有清楚的称呼、正文和署名，不额外添加邮件主题或“请查收”等未说出的内容。', '保持请求确认的语气，不把尚待确认的预算写成已经批准。'],
    weakExample: { output: '王老师您好，换一段，附件是这次活动的预算，总额两千八百元。请您周五前确认是否可以执行。换一段，谢谢，小林。', reason: '分段被转写成文字，没有成为实际段落。' }
  },
  {
    id: 'zh-apply-list-reorder-and-deletion', group: 'editing',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['zh-CN'], transcript: '今天要做三件事第一导出日志第二重启服务第三通知客户列成清单等一下重启先别做把通知客户放第一条再加一条备份配置' },
    example: '今天要做：\n1. 通知客户。\n2. 导出日志。\n3. 备份配置。',
    required: [{ pattern: '通知客户', reason: '保留通知任务' }, { pattern: '导出日志', reason: '保留日志任务' }, { pattern: '备份配置', reason: '加入最后补充的任务' }, { pattern: '(?:^|\\n)\\s*(?:[-*•]|[1-3][.、)])\\s*', reason: '生成实际列表而不是只提到“清单”' }],
    forbidden: [{ pattern: '重启|列成清单|放第一条|再加一条|等一下', reason: '删除明确取消的任务和编辑话术' }],
    ordering: [{ before: '通知客户', after: '导出日志', reason: '应用最新顺序，让通知客户排在首项' }, { before: '导出日志', after: '备份配置', reason: '未被重排的项目保持原相对次序' }],
    review: ['清单只含最终三项，不能把“不要重启”列成第四项。', '不要自行增加排查、工单号或其他操作。'],
    weakExample: { output: '今天要做：\n1. 导出日志。\n2. 重启服务先别做。\n3. 通知客户，放第一条。\n4. 备份配置。', reason: '格式像清单，但取消和重排指令都没有应用。' }
  },
  {
    id: 'zh-organize-two-topics', group: 'readability',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['zh-CN'], transcript: '发布这块呢安卓包已经过测了苹果这边还在等审核所以先不要对外发公告然后另外说一下客服的事情最近退订的问题比较多我下午会把操作步骤整理给大家' },
    example: '发布方面，安卓包已经通过测试，苹果端仍在等待审核，因此先不要对外发布公告。\n\n客服方面，最近关于退订的问题较多，我下午会把操作步骤整理给大家。',
    required: [{ pattern: '安卓', reason: '保留已过测的平台' }, { pattern: '苹果', reason: '保留仍待审核的平台' }, { pattern: '不要|暂不|暂时不|先不', reason: '保留暂缓公告的否定决定' }, { pattern: '退订', reason: '保留独立的客服事项' }, { pattern: '下午', reason: '保留步骤整理时间' }, { pattern: '\\n', reason: '把明确切换的两个话题分段' }],
    forbidden: [{ pattern: '这块呢|(?:然后)?另外说一下|再说一下.*事情', reason: '把口语转场整理成自然衔接，不能仅删一个“然后”' }],
    review: ['两个话题各成段落，能看出公告暂缓的原因，而非把内容压缩成一行标签。', '保留“我会整理”的责任，不增加客服答复承诺。'],
    weakExample: { output: '发布方面，安卓包已经通过测试，苹果这边还在等审核，所以先不要对外发公告。\n\n另外说一下客服的事情：最近退订问题比较多，我下午会把操作步骤整理给大家。', reason: '真实模型初版做了分段和部分改写，但第二个话题仍照搬口语转场。' }
  },
  {
    id: 'zh-preserve-uncertainty', group: 'preservation',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['zh-CN'], transcript: '我们可能周五能交初稿但我还不能保证要等法务确认如果他们没回复就先不要向客户承诺这个时间' },
    example: '我们可能在周五交付初稿，但目前还不能保证，需要等待法务确认。如果法务没有回复，先不要向客户承诺这个时间。',
    required: [{ pattern: '可能|也许|有望', reason: '保留时间仍不确定' }, { pattern: '周五', reason: '保留暂定日期' }, { pattern: '初稿', reason: '保留交付范围' }, { pattern: '不能保证|无法保证|尚未确定|还不能确定|不能确定', reason: '保留明确的不承诺状态' }, { pattern: '法务', reason: '保留依赖方' }, { pattern: '不要.*承诺|不.*承诺|暂不.*承诺', reason: '保留面向客户的限制' }],
    forbidden: [{ pattern: '保证周五|确保周五|一定.*周五|周五.*一定|已确认', reason: '不能把不确定性润写成承诺' }],
    review: ['保留“法务未回复”这个条件，不能概括成单纯延迟交付。', '语气可以顺畅，事实的把握程度不能增强。'],
    weakExample: { output: '我们保证周五交付初稿，等待法务确认后即可向客户承诺。', reason: '删掉不确定性并反转了不得承诺的限制。' }
  },
  {
    id: 'zh-preserve-negation-and-contrast', group: 'preservation',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['zh-CN'], transcript: '我不是说这个方案不能做我是说现在不要上线测试环境可以先跑但生产环境必须等回滚方案准备好' },
    example: '我不是说这个方案不能做，而是说现在不要上线。测试环境可以先运行，但生产环境必须等回滚方案准备好。',
    required: [{ pattern: '不是.*不能做', reason: '保留“并非否定方案”的双重否定' }, { pattern: '现在.*(?:不要|不能|不宜|暂不).*上线|暂缓上线', reason: '保留当前不上线的决定' }, { pattern: '测试环境.*(?:可以|可).*先', reason: '保留测试环境获准先行' }, { pattern: '生产环境', reason: '保留生产环境与测试环境的区别' }, { pattern: '回滚方案', reason: '保留上线前提' }],
    forbidden: [{ pattern: '方案不可行|方案不能做[。！]|立即上线', reason: '不能把时机限制改成方案否决或立即发布' }],
    review: ['对比关系一读即明：方案可做、测试可跑、生产暂缓。', '不能删除生产上线必须等到回滚方案就绪的强约束。'],
    weakExample: { output: '这个方案不能做，测试环境和生产环境都必须等回滚方案准备好。', reason: '压缩过度反转否定，并抹掉两种环境的不同安排。' }
  },
  {
    id: 'zh-preserve-intentional-emphasis', group: 'preservation',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['zh-CN'], transcript: '这个点很重要很重要请不要再删日志了我重复一遍不要再删日志了需要清理的话先找我确认' },
    example: '这个点很重要，很重要：请不要再删日志了。我重复一遍，不要再删日志了。需要清理的话，先找我确认。',
    required: [{ pattern: '很重要[^。！？]*很重要', reason: '保留明确的重复强调' }, { pattern: '不要再删日志[^]*不要再删日志', reason: '保留说话者明确要求重复的禁止事项' }, { pattern: '先.*(?:找我|跟我|向我|与我).*确认', reason: '保留先确认再清理的条件' }],
    forbidden: [],
    review: ['重复是语气和强调，不是口吃；可以调整标点，不能只保留一次。', '不把“找我确认”升级为“严禁任何清理”。'],
    weakExample: { output: '这个点很重要：请不要再删日志。需要清理的话，先找我确认。', reason: '误把有意重复当成赘词，削弱了明确表达的强调。' }
  },
  {
    id: 'en-preserve-literal-quotation', group: 'preservation',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['en'], transcript: 'um add this to the interview notes the participant said quote I I I cannot log in end quote that repeated I is in the original recording' },
    example: 'The participant said, “I I I cannot log in.” The repeated “I” is in the original recording.',
    required: [{ pattern: 'I(?:[ ,]+I){2}', reason: 'retain the stutter inside the literal quotation' }, { pattern: 'cannot log in', reason: 'retain the reported failure' }, { pattern: 'original recording', reason: 'retain the explanation that the repetition is source content' }],
    forbidden: [{ pattern: '^\\s*um\\b|\\bend quote\\b|\\badd this to\\b', reason: 'remove the surrounding filler and apply quotation notation' }],
    review: ['Distinguish literal source speech from the surrounding narration; quote boundaries must be clear.', 'Do not repair the participant’s quoted stutter or invent an explanation for the login failure.'],
    weakExample: { output: 'The participant said, “I cannot log in.” The repetition is in the original recording.', reason: 'Removes exactly the quoted source feature that the speaker wanted preserved.' }
  },
  {
    id: 'en-dictated-question-is-not-a-query', group: 'preservation',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['en'], transcript: 'Could you explain why the build passed locally but failed in CI and whether the lockfile was committed I need that answer before approving the release' },
    example: 'Could you explain why the build passed locally but failed in CI, and whether the lockfile was committed? I need that answer before approving the release.',
    required: [{ pattern: '(?:Could|Can|Would) you explain|Why did', reason: 'keep the request as a question rather than answering it' }, { pattern: 'locally', reason: 'retain the local-versus-CI contrast' }, { pattern: '\\bCI\\b', reason: 'retain the failing environment' }, { pattern: 'whether.*lockfile|was the lockfile', reason: 'preserve uncertainty about committing the lockfile' }, { pattern: 'before approving|before I approve|before.*approval', reason: 'retain the release-approval dependency' }, { pattern: '[?？]', reason: 'punctuate the dictated question' }],
    forbidden: [{ pattern: 'because the lockfile|the cause is|you should run|npm ci|usually caused', reason: 'do not answer, diagnose, or add a command in dictation mode' }],
    review: ['This case must run with mode voice_transcript through the real provider, not ask_anything or a mocked reply.', 'Keep the two questions and release dependency, without guessing why CI failed.'],
    weakExample: { output: 'The build usually failed in CI because the lockfile was not committed. You should run npm ci before approving the release.', reason: 'Answers the dictated question and invents a diagnosis.' }
  },
  {
    id: 'zh-repair-unambiguous-asr-word', group: 'readability',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['zh-CN'], transcript: '明天的线上回意改到下午两点请大家提前五分钟加入腾讯会议会议链接我稍后发到群里' },
    example: '明天的线上会议改到下午两点，请大家提前五分钟加入腾讯会议。会议链接我稍后发到群里。',
    required: [{ pattern: '线上会议', reason: '根据同句中的会议软件、加入与链接语境修复明确的 ASR 同音错误' }, { pattern: '明天', reason: '保留相对日期而不擅自换成具体日期' }, { pattern: '下午(?:两|二|2)点|14[:：]00', reason: '保留会议时间' }, { pattern: '(?:五|5)分钟', reason: '保留提前加入的时长' }, { pattern: '腾讯会议', reason: '保留指定软件' }, { pattern: '稍后.*群', reason: '保留稍后发到群里的安排' }],
    forbidden: [{ pattern: '线上回意', reason: '不把明确的识别错词原样交付' }],
    review: ['只修复明确的同音识别错误，不增加链接、房间号或把两点改成其他时间。', '保持一句通知加一句补充的自然组织。'],
    weakExample: { output: '明天的线上回意改到下午两点，请大家提前五分钟加入腾讯会议，会议链接我稍后发到群里。', reason: '只补标点，没有利用明确语境修复识别错误。' }
  },
  {
    id: 'zh-preserve-ambiguous-name', group: 'preservation',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['zh-CN'], transcript: '把这份文件发给小禾我不确定他的名字是不是这个写法先按小禾写不要改成小何' },
    example: '把这份文件发给小禾。我不确定他的名字是否是这个写法，先按“小禾”写，不要改成“小何”。',
    required: [{ pattern: '小禾', reason: '保留说话者指定但尚未确认的名字' }, { pattern: '不确定|尚未确定|还不确定', reason: '保留拼写不确定的事实' }, { pattern: '不要.*小何|不改成.*小何', reason: '保留消息本身对收件人的明确限制' }],
    forbidden: [{ pattern: '发给小何|姓名已确认|名字已确认', reason: '不能凭常见姓名擅自纠正不确定信息' }],
    review: ['这里“先按小禾写”是给收件人的消息内容，不能当成应删除的无意义旁白。', '保留不确定性，不根据常见用字猜姓名。'],
    weakExample: { output: '把这份文件发给小何，他的名字已确认。', reason: '把不确定的姓名擅自改成更常见的写法，并编造确认状态。' }
  },
  {
    id: 'mixed-preserve-amounts-and-identifiers', group: 'preservation',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['zh-CN', 'en'], transcript: '订单号A007B退款金额是零点零五美元不是五美元版本先停在v1.0.10不要升到v1.1.0备注写beta only' },
    example: '订单号 A007B，退款金额为 0.05 美元，不是 5 美元。版本先停在 v1.0.10，不要升到 v1.1.0。备注：beta only。',
    required: [{ pattern: 'A007B', reason: '保留混合订单号和前导零' }, { pattern: '0\\.05|零点零五', reason: '保留实际退款金额的小数精度' }, { pattern: '不是\\s*(?:5|五)\\s*美元', reason: '保留对容易混淆金额的明确否定' }, { pattern: 'v1\\.0\\.10', reason: '保留当前版本完整标识符' }, { pattern: '不要.*v1\\.1\\.0|不升级.*v1\\.1\\.0', reason: '保留不升级的版本限制' }, { pattern: 'beta only', reason: '保留未要求翻译的英文备注' }],
    forbidden: [
      { pattern: 'A07B|0\\.5\\s*美元|已升级|正式版', reason: '不能丢前导零、改变金额、改成已升级或翻译成相反发布状态' },
      { pattern: '备注写|备注填写|备注填上', reason: '把“备注写”应用成实际备注字段，而不保留填写口令' }
    ],
    review: ['“不是五美元”是避免误付的对比说明，不是撤回零点零五美元；必须保留。', '可以规范空格和数字，不能总结成“核对订单及版本信息”；将备注写入实际字段，而不是叙述填写动作。'],
    weakExample: { output: '订单号 A07B，退款 0.5 美元。版本已升级到 v1.1.0，备注：正式版。', reason: '看似简洁但改变了每一项关键事实。' }
  },
  {
    id: 'en-forwarding-request-addresses-the-reader', group: 'preservation',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['en'], transcript: 'Could you tell Alex the draft is ready I cannot reach him' },
    example: 'Could you tell Alex the draft is ready? I cannot reach him.',
    required: [{ pattern: '(?:Could|Can|Would) you (?:tell|let|inform)|Please (?:tell|let|inform)', reason: 'retain the request to the reader to pass on a message' }, { pattern: '\\bAlex\\b', reason: 'retain who should receive the forwarded information' }, { pattern: 'draft is ready|draft[’\']s ready', reason: 'retain the information to forward' }, { pattern: '(?:cannot|can[’\']t|unable to) reach him', reason: 'retain the reason help is needed' }],
    forbidden: [{ pattern: '^\\s*(?:Hi |Hello |Dear )?Alex\\s*[,，:：]', reason: 'do not replace a forwarding request with an invented message addressed to Alex' }],
    review: ['This is a legitimate request within the dictated message; the recipient must still be asked to contact Alex.', 'Removing meta instructions must not erase the reader’s requested action or the speaker’s inability to reach Alex.'],
    weakExample: { output: 'Hi Alex, the draft is ready.', reason: 'Mistakes a request to the reader for a dictation editing instruction and invents a direct message.' }
  },
  {
    id: 'en-spelling-correction-targets-only-one-person', group: 'editing',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['en'], transcript: 'Sarah owns the design review and another Sarah owns QA the QA owner spells her name Sara without an H the design reviewer is still Sarah with an H' },
    example: 'Sarah owns the design review, and Sara owns QA.',
    required: [
      { pattern: '\\bSarah\\b[^.\\n;]{0,35}\\bdesign(?: review)?\\b|\\bdesign(?: review)?\\b[^.\\n;]{0,35}\\bSarah\\b', reason: 'keep the design reviewer’s unchanged spelling Sarah' },
      { pattern: '\\bSara\\b[^.\\n;]{0,35}\\bQA\\b|\\bQA\\b[^.\\n;]{0,35}\\bSara\\b', reason: 'apply Sara only to the QA owner' }
    ],
    forbidden: [{ pattern: '(?:without|with) (?:an? |the )?H|spells? her name|reviewer is still', reason: 'apply targeted spelling asides rather than copying their explanation' }],
    review: ['Keep two distinct owners: Sarah for design review, Sara for QA; a global string replacement is incorrect.', 'The corrected spelling should appear in the assignment itself; merely mentioning both names elsewhere is not enough.'],
    weakExample: { output: 'Sara owns the design review, and Sara owns QA.', reason: 'A global name replacement changes the unrelated design reviewer too.' }
  },
  {
    id: 'zh-drafting-request-without-body-stays-a-request', group: 'preservation',
    request: { mode: 'voice_transcript', polishLevel: 'strong', languages: ['zh-CN'], transcript: '麻烦你帮我起草一封给房东的邮件问一下能不能下周再交房租我还没想好具体怎么写你先给我一个草稿看看' },
    example: '麻烦你帮我起草一封给房东的邮件，询问能否下周再交房租。我还没想好具体怎么写，你先给我一个草稿看看。',
    required: [{ pattern: '(?:帮我|为我).*起草|帮我.*写', reason: '保留向当前读者提出的拟稿请求' }, { pattern: '房东', reason: '保留拟稿对象' }, { pattern: '下周', reason: '保留希望询问的缴费时间' }, { pattern: '房租', reason: '保留邮件议题' }, { pattern: '没想好|尚未想好|还没确定', reason: '保留尚无明确正文这一事实' }, { pattern: '草稿', reason: '保留先看草稿的请求' }],
    forbidden: [{ pattern: '尊敬的房东|房东您好|房东先生|因(?:为)?(?:资金|工资|经济)|感谢您的理解|此致|敬礼', reason: '不能替用户生成未提供正文的邮件，或编造延迟原因与客套结尾' }],
    review: ['voice_transcript 模式只整理发给读者的请求，不能执行请求生成一封给房东的邮件。', '没有邮件正文、原因或承诺时，不能借“去掉编辑指令”擅自生成它们；保留拟稿请求和不确定状态。'],
    weakExample: { output: '尊敬的房东：\n\n由于工资尚未到账，我希望能在下周支付房租。感谢您的理解。\n\n此致\n敬礼', reason: '把被听写的拟稿请求当成对模型的命令，并编造了未说出的工资原因。' }
  }
] satisfies readonly QualityFixture[]

export const fixtureGroups = [
  { id: 'readability', focus: '自然成句、修复明显错误、段落组织', fixtures: refinementQualityFixtures.filter(fixture => fixture.group === 'readability') },
  { id: 'editing', focus: '应用口述修改、拼写、格式、删除与重排', fixtures: refinementQualityFixtures.filter(fixture => fixture.group === 'editing') },
  { id: 'preservation', focus: '保护否定、条件、不确定性、强调、引用与标识符', fixtures: refinementQualityFixtures.filter(fixture => fixture.group === 'preservation') }
]

export function refinementQualityFailures(fixture: QualityFixture, output: string): string[] {
  const failures = fixture.required.filter(rule => !new RegExp(rule.pattern, 'iu').test(output)).map(rule => rule.reason)
  failures.push(...fixture.forbidden.filter(rule => new RegExp(rule.pattern, 'iu').test(output)).map(rule => rule.reason))
  for (const rule of fixture.ordering ?? []) {
    const before = output.search(new RegExp(rule.before, 'iu'))
    const after = output.search(new RegExp(rule.after, 'iu'))
    if (before < 0 || after < 0 || before >= after) failures.push(rule.reason)
  }
  return output.trim() ? failures : ['模型必须返回非空润写正文，不能把空回答当作通过', ...failures]
}

export function gradeRefinementQuality(fixture: QualityFixture, output: string) {
  const failures = refinementQualityFailures(fixture, output)
  return {
    id: fixture.id,
    status: failures.length ? 'failed' : 'needs-human-review',
    failures,
    output,
    example: fixture.example,
    review: fixture.review
  }
}
