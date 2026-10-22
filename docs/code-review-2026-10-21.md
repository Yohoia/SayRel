# Sayrel 全项目审查，2026-10-21

首次审查确认 9 个问题，其中 5 个 P1、4 个 P2。下文保留首次审查的问题与复现证据。这 9 个问题现已修复，修复位置、回归检查和验收边界见 [修复记录](code-review-fixes-2026-10-21.md)。

## 审查范围与方法

审查基线为 `56cf77710b73c4945e01197ddf08e1a3323c8f08`，范围包含当前工作区的未提交修改及未跟踪源码。用户要求全项目审查，因此把技能原本的分支差异审查扩展为当前源码审查。问题编号不表示全部都是本次未提交修改引入的回归。

使用的技能与评审视角：

- mattpocock `code-review`，分别审查 Standards 与 Spec，独立评审后保留两个视角。
- superpowers `requesting-code-review`，独立检查运行可靠性、边界、持久化、音频编码及发布条件。
- superpowers `verification-before-completion`，根据本次实际命令和隔离复现报告验证结果。

规范与需求依据包括 `AGENTS.md`、`docs/agents/`、`docs/project-structure.md`、`DESIGN.md`、`README.md`、设置与界面对齐文档，以及 `docs/continuation-status.md`。GitHub Issues 查询未返回条目，因此未使用单一 issue 作为全项目规格。重构建议文档不作为强制编码规范。

主进程、preload、shared、六个窗口、Provider 传输、录音会话、Worker、SQLite 和打包配置均有源码审查覆盖。下面按视角呈现问题，跨视角重复发现只计一次。

## Standards

代码整体遵循项目文档要求的进程分层，Provider 凭据采用加密持久化，录音会话保存配置快照并校验取消后的会话身份。该轴发现 3 个实际行为缺陷，没有把命名偏好或工具已能检查的问题列为规范违规。

### R1 · P1 · 半小时磁盘检查删除全部历史和录音

位置：[cleanup.ts:33](../src/main/services/cleanup.ts#L33)，删除实现为 [history.ts:211](../src/main/services/history.ts#L211)。

`*/30 * * * *` 定时任务无条件调用 `history.deleteByDuration(Math.max(0, 0))`。参数为零时，删除截止时间就是当前时刻，因此已有历史记录及其关联录音都会被删除。该任务在应用启动时注册，且不检查历史或音频保留设置。触发时间是每小时的整点和半点。

隔离复现使用实际的 cleanup、history 和 schema 代码，连接内存 SQLite，并用捕获的定时回调替代实际等待。历史和音频均设为永久保存时，执行回调仍得到：

```text
half-hour before: Preserve me
half-hour after: null
half-hour deleted audio: true
```

修复方向是从磁盘使用检查中移除历史删除调用。若需要清理孤立文件，必须单独判断文件是否仍被历史记录引用。

### R2 · P1 · 音频到期会连同文字历史一起删除

位置：[cleanup.ts:22](../src/main/services/cleanup.ts#L22)，同类调用位于 [ipc/history.ts:57](../src/main/ipc/history.ts#L57)。

音频保留任务把 `audioRetentionDays` 传给删除整条历史的 `deleteByDuration()`。默认设置为文字永久保存、音频保留 30 天，实际结果却是 30 天前的文字记录也被删除，甚至包括没有录音文件的记录。此问题独立于 R1，修复 R1 后仍存在。

隔离 SQLite 复现将历史设为永久、音频设为 30 天。31 天前的纯文字记录在执行夜间回调后由 `Text must survive audio retention` 变成 `null`。

音频保留需要独立操作，只删除音频文件并清空文件路径，保留文字历史。

### R3 · P2 · 原生异步调用泄漏 Koffi 回调槽位

位置：[native.ts:192](../src/main/lib/native.ts#L192)，设备枚举同样存在于 [native.ts:228](../src/main/lib/native.ts#L228)。

每次上下文查询及设备枚举都调用 `koffi.register()`，完成后没有对应的 `koffi.unregister()`。一次默认录音上下文采集至少占用两个槽位。安装的 Koffi 最多允许 8,192 个已注册回调，耗尽后，上下文查询和设备枚举会持续失败，直到进程退出。

隔离复现运行实际转译后的 native 模块，使用真实 Koffi 注册，并以立即完成的假原生函数替代系统操作：

```json
{"completedContextCalls":8191,"registeredCallbacks":8192,"error":"Too many callbacks are in use (max = 8192)"}
```

需要在原生回调实际结束后释放注册，同时处理超时后迟到的回调。仅在 JavaScript 超时时注销并不安全，因为 Swift 仍可能调用该指针。

Standards 共 3 项，其中最严重的是 R1 的无条件数据删除。没有额外计入纯代码气味建议。

## Spec

该轴发现 2 项，其中 R1 与 Standards 重复。文档明确接受的云服务、完整课程、Markdown 表现、统计范围及像素验收限制没有列为新缺陷。

### R1 · P1 · 定时删除违反永久保留约定

[docs/hub-ui-alignment.md:14](hub-ui-alignment.md#L14) 定义 `0` 为永久保存。R1 的半小时任务会删除设置为永久的历史，直接违反该约定。技术证据见上文，不重复计数。

### R4 · P2 · 空筛选页和重新启用保存会跳过删除确认

位置：[History.tsx:113](../src/renderer/hub/pages/History.tsx#L113)。

[docs/hub-ui-alignment.md:14](hub-ui-alignment.md#L14) 要求缩短保留期必须确认。当前逻辑用当前筛选结果的 `items.length` 判断是否确认，同时在 `historyEnabled=false` 时直接保存新保留期。

两种触发方式都不会弹出确认：

- 已有旧口述记录，切换到没有记录的问答标签，把永久保存改为 24 小时。
- 先选从不保存，再选 24 小时，即使已有记录仍直接保存。

之后定时保留任务会删除超龄记录。通过 TypeScript AST 提取实际 JSX 的 `onChange` 函数并在隔离 VM 执行，以上两种情况均只调用 `patch()`。有可见记录且原先启用保存的对照组会调用 `setConfirmation()`。

是否需要确认应依据全局已有历史与原保留期判断，不应取决于当前筛选结果或是否保存新记录。

Spec 共 2 项，最严重的是违反永久保留约定的 R1；R4 为该轴独立发现。

## Superpowers 运行与发布审查

### R5 · P1 · 普通录音尾帧导致转写在请求供应商前失败

位置：[opusWorker.ts:176](../src/main/workers/opusWorker.ts#L176)，调用入口为 [transcription.ts:27](../src/main/services/transcription.ts#L27)。

录音停止会排出任意长度的尾包，但编码器直接把不足一帧的最后一个 PCM 切片及其实际长度传给 Opus。Opus 只接受规定的帧长度。失败后的文件备用路径仍使用同一编码逻辑，无法恢复。

用当前 Worker 源码和真实安装的 OpusScript 对合成 PCM 执行编码：

| PCM 样本数 | 结果 |
| --- | --- |
| 16,000 | 编码成功 |
| 16,001 | `Encode error: Bad argument` |
| 16,682 | `Encode error: Bad argument` |
| 16,320 | 编码成功 |

`transcribe()` 在调用任何供应商前先执行编码，因此此问题影响所有走该入口的实时口述。最后一帧需要填充到合法长度，并记录真实采样长度以计算时长与末尾裁剪。

### R6 · P1 · 编码成功的输出也不是有效的完整 Ogg/Opus

位置：[opusWorker.ts:174](../src/main/workers/opusWorker.ts#L174)，以及同文件的 `headerPage()`、`writePacket()` 和 `finish()`。

`headerPage()` 只返回头页，没有加入输出页数组，调用方又丢弃返回值，因此输出缺少 `OpusHead`、`OpusTags` 和流起始标志。此外，granule 使用 16 kHz 样本计数，未换算为 Opus 的 48 kHz 时钟，结束页也未设置 EOS。

实际编码 16,000 个样本得到 1,550 字节，两个头部签名均不存在，第一页 flags 为 `0`，granule 为 `320`。下载录音及读取 Ogg 容器的供应商无法依赖这种格式。内部兼容无头音频的解码逻辑会掩盖部分问题。

需要输出正确的标识页、注释页、序号、48 kHz granule 和结束页，并使用独立解码器验证。R5 修复帧长度，R6 修复容器，两者需要分别处理。

### R7 · P1 · 安装包遗漏数据库迁移文件，启动初始化失败

位置：[package.json:101](../package.json#L101)，读取逻辑为 [db/index.ts:17](../src/main/db/index.ts#L17)。

应用打包只包含 `out/**/*` 和 `package.json`。`extraResources` 仅复制 `build`、`lib` 和 `locales`，没有 `db`。构建也没有把 SQL 嵌入 JavaScript。安装环境不存在开发源码路径，数据库初始化找不到任何迁移目录，会抛出 `no migrations directory found`，启动流程在创建窗口前中断。

用安装的 electron-builder `FileMatcher` 和当前配置检查，`resources/db/0000_init.sql` 与 `src/main/db/sql/0000_init.sql` 均不进入应用文件或额外资源；对照的主进程入口与 locale 文件均正确匹配。

将 `resources/db/**/*` 纳入额外资源，并在无源码目录的安装布局中验证启动。本次验证的是实际打包匹配规则，没有安装并运行签名后的应用。

### R8 · P2 · 语音验证入口仍指向已迁移的 worklet 路径

位置：[worklet-drain.cjs:5](../scripts/diagnostics/worklet-drain.cjs#L5)。

`npm run verify:voice` 在 19 项 PASS 后以 `ENOENT` 退出。脚本读取已不存在的 `src/renderer/public/capture-worklet.js`，实际文件为 `public/capture-worklet.js`，且后续 Swift 检查因此不会执行。

需要更新脚本路径。本次单独对真实新路径执行原有尾包与 ACK 断言，通过；单独运行 Swift 回放也通过 14 项。主验证入口本身仍然失败。

### R9 · P2 · 离线 UI 构建未同步公共资源路径

位置：[ui-build.mjs:6](../scripts/ui-build.mjs#L6)。

该脚本关闭默认配置，以 `src/renderer` 为 root，却没有设置主构建已有的项目根 `publicDir`。当前字体 CSS 位于根目录 `public/fonts/`，构建无法解析 `/fonts/typeless-fonts.css`，报 `ENOENT`。

`npm run verify:providers` 的配置、传输、实时协议、Electron 设置及 IPC 检查通过，随后在此构建处退出，Provider UI 检查未执行。同一脚本也是 `verify:ui` 的首步，因而阻断该验证入口。

离线构建需要同步实际公共资源路径，并检查迁移后的字体、图标和 worklet 是否进入输出。

## 本次验证结果

| 命令或验证 | 本次结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过，保留动态与静态混合导入及第三方注释警告 |
| `npm run verify:settings` | 7 项通过 |
| `npm run verify:voice` | 失败，19 项通过后遇到 R8 |
| `python3 scripts/diagnostics/native-hotkeys.py` | 单独执行，14 项通过 |
| 新路径 worklet 尾包及 ACK 断言 | 单独执行，通过 |
| `npm run verify:providers` | 配置、35 项传输与失败检查、21 个实时场景、Electron 设置及 IPC 检查通过，随后遇到 R9 |
| 隔离内存 SQLite | 复现 R1、R2 |
| 实际 native 模块与真实 Koffi 注册 | 复现 R3 的回调槽位耗尽 |
| 实际 History JSX 回调 | 复现 R4 的两种确认绕过 |
| 实际 Opus Worker 与真实 OpusScript | 复现 R5、R6 |
| electron-builder 文件匹配器 | 确认 R7 的 SQL 排除 |

隔离复现没有访问用户历史数据库、麦克风、真实键盘输入、剪贴板或付费供应商。验证过程中产生了构建缓存及临时文件，业务源码未修改。实际 SQLite 复现使用 Electron 对应的 Node ABI，系统 Node 的 ABI 与现有 better-sqlite3 构建不匹配，因此未执行依赖重建。

真实麦克风到目标输入框的端到端过程、付费供应商、操作系统权限交互、签名安装包运行和 UI 像素验收未完成。当前离线 UI 构建失败，因此没有本轮 UI 验收结论。此报告记录已确认问题，不保证不存在其他缺陷。

建议先修复 R1、R2 的数据删除，再处理 R5、R6 的编码与 R7 的安装启动问题。R8、R9 需要恢复后用于后续验证；R3、R4 分别补齐长期运行的回调生命周期和保留期确认行为。
