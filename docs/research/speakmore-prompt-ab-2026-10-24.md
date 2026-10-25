# SpeakMore 原版提示词真实模型 A/B

日期：2026-10-24。本轮只比较提示词，没有切换应用的默认策略。

## 实验范围

- 同一个已配置的 DeepSeek `deepseek-flash`，使用生产 `completeChat` 的听写请求参数，`thinkingMode=auto`。
- 同一批 22 条公开/合成文本，每条每套提示词调用一次，共 44 次真实请求，0 请求错误，无自动重试。先运行 SayRel，再运行 SpeakMore；每批最多两个请求并发。
- SayRel 使用 `dictation-2026-10-24.3`；SpeakMore 使用本地上游提交 `7bf21240c80a39056b84a8a30e7b36d4a371aa7a` 的文本整理 prompt。不是音频直出 prompt，也不是 Typeless 原版 prompt。
- 候选保留原版 system、原文标签、提醒句和词典拼接逻辑，22 条输入逐字比对原版构造函数通过。没有叠加 SayRel 的语言、风格或编辑规则，没有运行 SpeakMore 的输出正则、繁转简和去句号逻辑。
- 仅使用合成文本，无私人录音/历史/输入框上下文上传。读取凭据仅用于正常请求，没有保存密钥或修改用户设置。
- 未运行或测试完整 SpeakMore 应用，因此不能把结果描述为 SpeakMore 产品的实际质量或延迟。

## 观察

1. 用户关心的中文待办：两边本次都没有括号；SpeakMore 原版允许括注，但并非每次都使用。它保留了更多口语表达，并省略了“机场”这个地点限定。
2. 两边都应用了改口后的时间地点；SpeakMore 仍把“给陈经理发个消息”“标题写”留在正文。
3. 明确重复强调：SayRel 本次保留，SpeakMore 删除了“很重要”的重复以及“不要再删日志”的再次强调。它的原版规则倾向合并重复，不能直接等同于当前项目的保真要求。
4. SpeakMore 的中文报告分点和话题分段有可借鉴之处；但“列成清单”“备注写”“通知写”和拼写解释仍可能作为正文交出。
5. 否定、未确认姓名、金额/版本、向读者提出的转告和拟稿请求，本轮未观察到事实反转或凭空执行请求。有限样本不能排除其他输入中的问题。

## 如何理解检查结果

初始检查把“下午 3 点”“上午 10 点”“5 分钟”等合法空格误报为信息缺失，已补充先失败后通过的测试，修正数字排版匹配；同时补上“机场”地点不可丢失的约束。错误数字仍会失败。没有修改模型返回值，也没有重跑挑选更好的样本。

- SayRel .3：1/22 条触发至少一项最低约束。
- SpeakMore 原版：10/22 条触发至少一项最低约束。

这些约束是 SayRel 的目标要求，其中包含书面化和去编辑口令偏好，并非中立的全球质量分。不能转换成准确率或宣称统计显著优劣。每条只采样一次；此前同一 SayRel 策略的其他批次也曾有更多失败，存在生成波动。

建议：保留原版作独立候选对照，借鉴具体成稿示例与分段方式；目前不直接替换默认深整理。若继续试验，应将“严格原版”和“按用户偏好适配”分开标识，不能改过规则后仍称原版。

## 证据与复跑

原始请求记录位于 `.build/refinement-evaluation/speakmore-ab-{sayrel,original}-20261024/results.json`，保留各自 prompt 源快照和每条 prompt 哈希；修正规则后的评分另存于 `.build/refinement-evaluation/speakmore-ab-20261024/comparison.json`，原始记录未覆盖。

原版候选与 MIT 许可、上游文件摘要位于 `.build/refinement-candidates/speakmore-7bf21240c80a/`。

```sh
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/diagnostics/refinement/refinement-live.cjs \
  --live --profile /absolute/path/to/existing-profile --label unique-speakmore-run --levels strong \
  --prompt-file .build/refinement-candidates/speakmore-7bf21240c80a/prompt-source.ts
```

复跑会产生新的模型请求和费用，可能得到不同输出。不要覆盖现有标签。

## 逐条实际输出

以下全部为本次真实模型输出，不用人工理想答案替代。

### tour-todo-zh-actionable-not-narrated

输入：

```text
周五之前有几件事。先网上值机，再收拾大行李箱，然后预订机场停车位。等等，先订停车位，便宜的位置很快就没了。行李箱的话，只住两晚，带登机箱就够了。
```

SayRel .3：

```text
周五前：
1. 先预订机场停车位，便宜的位置很快会被订完。
2. 网上值机。
3. 收拾登机箱即可，只住两晚。
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
周五之前有几件事：

1. 先订停车位，便宜的位置很快就没了
2. 网上值机
3. 收拾行李：只住两晚，带登机箱就够了
```

检查提醒：保留停车地点为机场；理由应压成简洁短注，不能把原话整句搬进括号

### tour-todo-en-actionable-not-narrated

输入：

```text
Okay, a few things before Friday. First check in online, then pack the big suitcase, and book the airport parking. Actually, book the parking first, the cheap spots always go fast. Oh, and the suitcase, it’s only two nights, so the carry-on’s plenty.
```

SayRel .3：

```text
Before Friday:
1. Book the airport parking first, since the cheap spots go fast.
2. Check in online.
3. Pack the carry-on; it’s only two nights, so that’s plenty.
```

检查提醒：remove abandoned choices and conversational narration from the task list

SpeakMore 原版：

```text
A few things before Friday:

1. Book the airport parking first — the cheap spots always go fast
2. Check in online
3. Pack the carry-on — it's only two nights, so the carry-on's plenty
```

检查提醒：remove abandoned choices and conversational narration from the task list

### zh-repair-stutter-and-syntax

输入：

```text
呃那个这这份报告我我昨天已经看了然后就是有两处地方需要改一下一个是收入那里少了华南区另外一个是附录还用的是旧版本麻烦你今天下午三点前更新一下
```

SayRel .3：

```text
这份报告我昨天已经看过了，有两处需要修改：收入部分少了华南区，附录仍是旧版本。麻烦你今天下午三点前更新一下。
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
这份报告我昨天已经看了，有两处地方需要改一下：

1. 收入那里少了华南区
2. 附录还用的是旧版本

麻烦你今天下午 3 点前更新一下。
```

最低约束未命中问题，仍需审读。

### en-repair-spoken-grammar

输入：

```text
um I has checked the invoice yesterday and the total are wrong because shipping got charged two times can you send me a corrected one before Friday please
```

SayRel .3：

```text
I checked the invoice yesterday, and the total is wrong because shipping was charged twice. Can you send me a corrected one before Friday, please?
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
I checked the invoice yesterday, and the total is wrong because shipping was charged twice. Can you send me a corrected one before Friday, please?
```

最低约束未命中问题，仍需审读。

### zh-apply-chained-corrections

输入：

```text
给陈经理发个消息说周三上午十点在二楼开会不对是周四上午十点地点不是二楼改成线上标题写项目复盘
```

SayRel .3：

```text
项目复盘
陈经理，会议定于周四上午10点线上召开。
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
给陈经理发个消息，说周四上午 10 点线上开会，标题写“项目复盘”。
```

检查提醒：删除被替换的内容和编辑口令，实际应用标题而不叙述“标题为”

### en-apply-spelling-and-ticket

输入：

```text
Hi Catherine please check ticket AB dash zero zero seven by noon thanks Mei oh the name is Katherine with a K not a C and write the ticket with the dash
```

SayRel .3：

```text
Hi Katherine,

Please check ticket AB-007 by noon.

Thanks,
Mei
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
Hi Katherine, please check ticket AB-007 by noon. Thanks, Mei.
```

最低约束未命中问题，仍需审读。

### zh-apply-email-line-breaks

输入：

```text
王老师您好换一段附件是这次活动的预算总额两千八百元请您周五前确认是否可以执行换一段谢谢小林
```

SayRel .3：

```text
王老师，您好：

附件是这次活动的预算，总额两千八百元。请您在周五前确认是否可以执行。

谢谢！

小林
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
王老师您好，

附件是这次活动的预算总额 2800 元，请您周五前确认是否可以执行。

谢谢！
小林
```

最低约束未命中问题，仍需审读。

### zh-apply-list-reorder-and-deletion

输入：

```text
今天要做三件事第一导出日志第二重启服务第三通知客户列成清单等一下重启先别做把通知客户放第一条再加一条备份配置
```

SayRel .3：

```text
今天要做三件事：
1. 通知客户。
2. 导出日志。
3. 备份配置。
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
今天要做三件事，列成清单：

1. 通知客户
2. 导出日志
3. 备份配置
```

检查提醒：删除明确取消的任务和编辑话术

### zh-organize-two-topics

输入：

```text
发布这块呢安卓包已经过测了苹果这边还在等审核所以先不要对外发公告然后另外说一下客服的事情最近退订的问题比较多我下午会把操作步骤整理给大家
```

SayRel .3：

```text
发布方面，安卓包已经通过测试，苹果这边还在等审核，所以先不要对外发公告。

客服方面，最近退订的问题比较多，我下午会把操作步骤整理给大家。
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
发布这块，安卓包已经过测了，苹果这边还在等审核，所以先不要对外发公告。

另外说一下客服的事情：最近退订的问题比较多，我下午会把操作步骤整理给大家。
```

检查提醒：把口语转场整理成自然衔接，不能仅删一个“然后”

### zh-preserve-uncertainty

输入：

```text
我们可能周五能交初稿但我还不能保证要等法务确认如果他们没回复就先不要向客户承诺这个时间
```

SayRel .3：

```text
我们可能周五能交初稿，但我还不能保证，需要等法务确认；如果法务没回复，就先不要向客户承诺这个时间。
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
我们可能周五能交初稿，但我还不能保证，要等法务确认。如果他们没回复，就先不要向客户承诺这个时间。
```

最低约束未命中问题，仍需审读。

### zh-preserve-negation-and-contrast

输入：

```text
我不是说这个方案不能做我是说现在不要上线测试环境可以先跑但生产环境必须等回滚方案准备好
```

SayRel .3：

```text
我不是说这个方案不能做，而是说现在不要上线。测试环境可以先跑，但生产环境必须等回滚方案准备好。
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
我不是说这个方案不能做，我是说现在不要上线。测试环境可以先跑，但生产环境必须等回滚方案准备好。
```

最低约束未命中问题，仍需审读。

### zh-preserve-intentional-emphasis

输入：

```text
这个点很重要很重要请不要再删日志了我重复一遍不要再删日志了需要清理的话先找我确认
```

SayRel .3：

```text
这个点很重要，很重要：请不要再删日志了。我再重复一遍，不要再删日志。需要清理的话，请先找我确认。
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
这个点很重要，请不要再删日志了。需要清理的话，先找我确认。
```

检查提醒：保留明确的重复强调；保留说话者明确要求重复的禁止事项

### en-preserve-literal-quotation

输入：

```text
um add this to the interview notes the participant said quote I I I cannot log in end quote that repeated I is in the original recording
```

SayRel .3：

```text
The participant said, “I I I cannot log in.” The repeated “I” is in the original recording.
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
Add this to the interview notes: the participant said, "I I I cannot log in." That repeated "I" is in the original recording.
```

检查提醒：remove the surrounding filler and apply quotation notation

### en-dictated-question-is-not-a-query

输入：

```text
Could you explain why the build passed locally but failed in CI and whether the lockfile was committed I need that answer before approving the release
```

SayRel .3：

```text
Could you explain why the build passed locally but failed in CI, and whether the lockfile was committed? I need that answer before approving the release.
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
Could you explain why the build passed locally but failed in CI, and whether the lockfile was committed? I need that answer before approving the release.
```

最低约束未命中问题，仍需审读。

### zh-repair-unambiguous-asr-word

输入：

```text
明天的线上回意改到下午两点请大家提前五分钟加入腾讯会议会议链接我稍后发到群里
```

SayRel .3：

```text
明天的线上会议改到下午两点。请大家提前五分钟加入腾讯会议，会议链接我稍后发到群里。
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
明天的线上会议改到下午 2 点，请大家提前 5 分钟加入腾讯会议。会议链接我稍后发到群里。
```

最低约束未命中问题，仍需审读。

### zh-preserve-ambiguous-name

输入：

```text
把这份文件发给小禾我不确定他的名字是不是这个写法先按小禾写不要改成小何
```

SayRel .3：

```text
把这份文件发给小禾。我不确定他的名字是不是这个写法，先按“小禾”写，不要改成“小何”。
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
把这份文件发给小禾，我不确定他的名字是不是这个写法，先按小禾写，不要改成小何。
```

最低约束未命中问题，仍需审读。

### mixed-preserve-amounts-and-identifiers

输入：

```text
订单号A007B退款金额是零点零五美元不是五美元版本先停在v1.0.10不要升到v1.1.0备注写beta only
```

SayRel .3：

```text
订单号 A007B 的退款金额为 0.05 美元，不是 5 美元。版本暂时停在 v1.0.10，不要升级到 v1.1.0。备注：beta only。
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
订单号 A007B，退款金额是 0.05 美元，不是 5 美元。版本先停在 v1.0.10，不要升到 v1.1.0。备注写 beta only。
```

检查提醒：把“备注写”应用成实际备注字段，而不保留填写口令

### en-forwarding-request-addresses-the-reader

输入：

```text
Could you tell Alex the draft is ready I cannot reach him
```

SayRel .3：

```text
Could you tell Alex the draft is ready? I cannot reach him.
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
Could you tell Alex the draft is ready? I cannot reach him.
```

最低约束未命中问题，仍需审读。

### en-spelling-correction-targets-only-one-person

输入：

```text
Sarah owns the design review and another Sarah owns QA the QA owner spells her name Sara without an H the design reviewer is still Sarah with an H
```

SayRel .3：

```text
Sarah owns the design review, and Sara owns QA.
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
Sarah owns the design review, and another Sara owns QA. The QA owner spells her name Sara, without an H; the design reviewer is still Sarah, with an H.
```

检查提醒：apply targeted spelling asides rather than copying their explanation

### zh-drafting-request-without-body-stays-a-request

输入：

```text
麻烦你帮我起草一封给房东的邮件问一下能不能下周再交房租我还没想好具体怎么写你先给我一个草稿看看
```

SayRel .3：

```text
麻烦你帮我起草一封给房东的邮件，问一下能不能下周再交房租。我还没想好具体怎么写，你先给我一个草稿看看。
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
麻烦你帮我起草一封给房东的邮件，问一下能不能下周再交房租。我还没想好具体怎么写，你先给我一个草稿看看。
```

最低约束未命中问题，仍需审读。

### zh-final-choice-without-old-plan-note

输入：

```text
明天下午三点去人民公园不对改成下午四点去市图书馆在那里碰面
```

SayRel .3：

```text
明天下午四点去市图书馆，在那里碰面。
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
明天下午4点去市图书馆碰面。
```

最低约束未命中问题，仍需审读。

### zh-retain-requested-parentheses

输入：

```text
通知写明天下午四点开会括号线上参会括号结束请准时参加
```

SayRel .3：

```text
通知：明天下午四点开会（线上参会），请准时参加。
```

最低约束未命中问题，仍需审读。

SpeakMore 原版：

```text
通知写：明天下午四点开会（线上参会），请准时参加。
```

检查提醒：格式口令应用为正文，不回显口令
