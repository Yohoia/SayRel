# Qwen 3.1 语音模型接入与原生润色实测

日期：2026-10-25。本轮接入模型并隔离测试其原生结果，没有更改用户的默认转写模型或文本润写模型。

## 官方协议与接入

- [模型选型](https://help.aliyun.com/zh/model-studio/asr-model)：Message 面向短段输入，Streaming 面向持续转写。两者不是旧 Qwen Realtime 的 session.update 协议。
- [Message 客户端事件](https://help.aliyun.com/zh/model-studio/qwen-asr-message-client-events)：使用 run-task、二进制 PCM 和 finish-task。显式开启 intermediate_result_enabled 才请求中间结果；disfluency_removal_enabled 控制原生润色，默认关闭。
- [Message 服务端事件](https://help.aliyun.com/zh/model-studio/qwen-asr-message-server-events)：按 sentence_id 替换草稿，sentence_end 确认句子，task-finished 结束任务。心跳不作为正文。
- [Streaming 客户端事件](https://help.aliyun.com/zh/model-studio/qwen-audio-asr-streaming-client-events)：使用同类任务协议，但不发送 Message 专用的润色开关。
- [WebSocket 入口](https://help.aliyun.com/zh/model-studio/qwen-asr-message-websocket-api)：支持业务空间专属域名；本轮沿用已保存的北京公共域名 /api-ws/v1/inference，实际调用成功，没有猜测或生成 Workspace ID。

## 当前项目行为

1. 阿里云预设新增 qwen-audio-3.1-asr-flash-message 与 qwen-audio-3.1-asr-flash-streaming；新旧模型路由使用同一个共享分类函数。
2. 两个模型均支持录音中发送音频、预览中间结果，以及失败后的完整录音重放；不会再被宽泛的 flash 正则误发到 HTTP 批量接口。
3. Message 在普通听写的轻整理／深整理档请求原生润色，原文档关闭；其他语音任务不主动请求原生润色。配置的独立写作模型仍按原有流程运行，没有被偷偷绕过。
4. providerPolish 只记录是否开启该服务参数，不伪造“发生改写”或“原始逐字稿”。开启时历史详情明确说明：转写栏已经是模型整理后的输出。
5. 已保存的供应商不会被悄悄迁移或重新激活。在编辑面板中，缺失的新预设模型有“添加模型”按钮。本轮已通过最新开发版的正常界面加入并保存两个模型，重新打开确认均在列表中；默认仍是 qwen3-asr-flash，文本润写模型也未切换。

## 实测方法

- 四段公开/合成文本，通过本机已安装的 macOS Tingting 语音合成；16kHz、单声道 PCM16，正常速度发送。不是私人录音，也不代表真实口音、麦克风或噪声环境。
- 每段完全相同的 WAV 分别运行 Message 关闭润色、Message 开启润色、Streaming，共 12 次请求，0 请求错误。每种条件只运行一次，不自动重试、不换供应商，不能计算稳定准确率。
- 使用生产 startLiveTranscription；所有请求都在模拟录音结束前收到过中间结果。这个观察证明本轮确实有实时返回，不是批量完成后伪造进度。
- 所有输出均直接来自语音服务，没有调用 DeepSeek、SpeakMore 提示词或其他独立文本模型，也没有删除括号的后处理。
- 测试脚本仅为正常请求解密凭据并留在内存，没有记录密钥、上传用户上下文、读取私人录音或写回设置。模型调用结束后，才通过产品正常界面保存上述模型列表变更。最初两次预检分别在凭据解密和 WAV 读取处退出，均未发出模型请求，不计入 12 次。

## 结果与限制

- 简单改口：Message 开启润色返回“明天下午4点去市图书馆，在那里碰面。”；关闭及 Streaming 保留原来的三点、公园与改口话术。
- 待办：原生润色仍添加了括号，停车未被提到第一项，还保留“大行李箱”。因此它没有满足用户当前的无自动括注、应用最终选择及顺序的全部要求。不能把它宣传成独立深整理的等价替代。
- 否定条件：本轮三种结果都保留了测试可先跑、生产必须等待回滚方案的限制。
- 重复强调：本轮原生润色保留了两次“很重要”和再次“不要再删日志”的强调。有限样本不代表永不误删。
- 参数的开关是原生清理能力，不是任意成文指令。服务并未在同一请求同时提供完整的逐字稿和润色稿；报告中的两种 Message 输出来自两个独立会话，不能冒称单次响应里的前后对照。

## 验证与复跑

新增 qwen31-asr.ts 最初在“录音中 ASR 必须支持新模型”失败；实现后通过五组录音／重放／开关隔离／最终结果边界测试。原有 Live ASR 30 个场景通过，录音恢复增加三档原生开关与元数据检查后共 42 个场景通过。

```sh
node --import tsx scripts/diagnostics/audio/qwen31-asr.ts
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/diagnostics/audio/qwen31-live.cjs \
  --live --profile /absolute/path/to/existing-profile --label unique-run
```

在线复跑会产生新的阿里云调用和费用。原始 WAV、音频哈希、中间文本与最终输出位于 .build/qwen31-evaluation/{smoke-20261025-c,comparison-20261025}/，不纳入 Git。耗时只用于诊断，不作为性能比较。

## 全部实际输出

### correction

合成录音脚本：

```text
明天下午三点去人民公园，不对，改成下午四点去市图书馆，在那里碰面。
```

message-native-cleanup：

```text
明天下午4点去市图书馆，在那里碰面。
```

message-raw：

```text
明天下午3点去人民公园，不对，改成下午4点去市图书馆，在那里碰面。
```

streaming：

```text
明天下午3点去人民公园，不对，改成下午4点去市图书馆，在那里碰面。
```

### todo

合成录音脚本：

```text
周五之前有几件事。先网上值机，再收拾大行李箱，然后预订机场停车位。等等，先订停车位，便宜的位置很快就没了。行李箱的话，只住两晚，带登机箱就够了。
```

message-raw：

```text
周五之前有几件事：先网上值机，再收拾大行李箱，然后预定机场停车位。等等，先定停车位，便宜的位置很快就没了。行李箱的话，只住两晚，带登机箱就够了。
```

message-native-cleanup：

```text
周五之前有几件事：1. 先网上值机2. 预订机场停车位（便宜的位置很快就没了）3. 收拾大行李箱行李箱的话，只住两晚，带登机箱就够了。
```

streaming：

```text
周五之前有几件事：先网上值机，再收拾大行李箱，然后预订机场停车位。等等，先订停车位，便宜的位置很快就没了。行李箱的话，只住两晚，带登机箱就够了。
```

### negation

合成录音脚本：

```text
我不是说这个方案不能做，我是说现在不要上线。测试环境可以先跑，但生产环境必须等回滚方案准备好。
```

message-raw：

```text
我不是说这个方案不能做，我是说现在不要上线。测试环境可以先跑，但生产环境必须等回滚方案准备好。
```

message-native-cleanup：

```text
我不是说这个方案不能做，我是说现在不要上线。测试环境可以先跑，但生产环境必须等回滚方案准备好。
```

streaming：

```text
我不是说这个方案不能做，我是说现在不要上线。测试环境可以先跑，但生产环境必须等回滚方案准备好。
```

### emphasis

合成录音脚本：

```text
这个点很重要，很重要。请不要再删日志了。我重复一遍，不要再删日志了。需要清理的话，先找我确认。
```

message-raw：

```text
这个点很重要很重要，请不要再删日志了，我重复一遍，不要再删日志了，需要清理的话，先找我确认。
```

message-native-cleanup：

```text
这个点很重要，很重要，请不要再删日志了。我重复一遍，不要再删日志了。需要清理的话，先找我确认。
```

streaming：

```text
这个点很重要很重要，请不要再删日志了，我重复一遍，不要再删日志了，需要清理的话先找我确认。
```
