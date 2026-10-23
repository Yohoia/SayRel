# #9：native 录音输入与录音工作包验收

验证日期：2026-10-23。范围对应 #9 与 #1 的工作包 D。

## 输入与状态规则

`hotkeys.ts` 保留物理组合识别、重复按下过滤、释放解释和 600ms 长按计时。每次物理手势生成独立标识，并向既有 `RecordingMachine` 发送按下、组合升级、释放或长按意图；适配器不再判断录音 phase，也不再组合调用开始、切换模式、结束及 handsFree 修改。

状态机决定操作是否适用，并关联手势与会话：

- idle/error 下的按下尝试启动；starting/recording 下的新按下结束当前录音；disabled、finishing 和 long_pressing 下忽略启动。
- 初始 Fn 因练习模式或配置被拒绝时，同一物理手势可以升级为可用的 Fn 组合；已经开始后取消的手势不能借升级复活。其他入口接受新录音时也清除旧手势的启动资格。
- starting 和 recording 下的组合升级只修改同一会话的模式，不提交初始模式、不重新打开设备。
- 释放由适配器解释为结束、免手持或取消；状态机只对该手势所属的有效会话执行。旧释放、旧长按及旧组合升级不影响新会话。
- 长按计时仍从首次 toggle 按下开始，组合升级不重置计时。状态机取消对应采集后显示长按提示，并由匹配的释放清理提示。

浮窗及 Electron 后备输入继续使用既有 START/TOGGLE/FINISH/CANCEL/RETRY 意图。会话身份、提供商快照、尾帧排空、停止确认、取消、重试、历史与练习所有权仍由原有实现负责；不引入新的录音状态模型或 IPC 能力。

## 行为检查

测试边界沿用 #1 已确认的录音意图到状态、事件和投递结果。`scripts/diagnostics/fn-shift-chain.cjs` 的 38 项检查不读取私有 session，覆盖 native、后备与浮窗入口，并执行真实主进程 IPC、preload、RecorderSessionController 和音频采集实现。设备、模型和操作系统边界使用离线替代依赖。

本次先复现并修复两项回归：native 启动拒绝后松键仍发布 handsFree；初始被拒绝的旧手势在其他入口完成录音后仍可借组合升级重新启动。

新增和扩展检查覆盖 starting/recording 两阶段 Fn+Shift/Fn+Space 升级、打开设备期间按住释放、旧手势隔离、第二次点击结束后的释放、三入口尾帧排空及单次投递、native/浮窗重试的提供商快照与练习所属窗口投递。

## 验收结果

| 检查 | 结果 |
| --- | --- |
| `npm run verify:voice` | 108 项 PASS：38 项主进程/入口链、6 项 renderer 生命周期、1 项 ScriptProcessor 尾帧、1 项 AudioWorklet 排空、62 项 Swift 事件回放。 |
| `npm run typecheck` | 通过。 |
| `npm run build` | 通过；静态/动态混用导入、依赖包注释和 lottie eval 的既有非阻断警告仍存在。 |
| `npm run verify:floating` | 14 项检查通过，errors 为空，生成 11 张截图。 |
| `npm run verify:settings` | 快捷键注册、禁用恢复、所有权和设置生效回归通过。 |
| `electron scripts/diagnostics/feature-tour.cjs` | 复用本轮离线 UI 构建，三个完整练习、native 组合反馈、窗口切换与资源清理通过。 |

浮窗证据位于 `docs/ui-evidence/floating-interactions/report.json` 及同目录 PNG。实际查看了 recording-countdown、hands-free-countdown、hands-free-processing、microphone-alert 四张截图：倒计时、取消/完成按钮、处理状态和中文错误操作均完整显示，无明显裁切。离线 UI 构建保留 locale 混用导入及大 chunk 的非阻断警告。

双轴代码审查已完成。Standards 提出的对象参数和重复点击测试辅助代码两项改进均已修复，复核剩余问题为 0；Spec 轴未发现遗漏、越界行为或新增正确性问题。检查以开始本任务时已有的 #8 暂存内容为基线，不包含无关的代理配置改动。

## 验收边界

Swift 检查回放真实按键解释函数，不创建系统 event tap 或向桌面发送按键。音频链使用合成设备，UI 检查使用真实 renderer 和窗口导航配合 fixture 状态/IPC。因此，本次没有执行物理键盘到真实麦克风、在线模型和外部应用粘贴的实机贯通验证；没有更改系统权限、读取真实凭据或访问用户录音。构建结果不作为界面检查的替代。
