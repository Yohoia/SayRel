# Sayrel 审查问题修复记录

2026-10-21。[首次审查](code-review-2026-10-21.md)的 R1 至 R9 均已修复。本轮保留工作区原有修改，没有提交或发布。

## 修复与回归对应

| 问题 | 修复 | 验证入口 |
| --- | --- | --- |
| R1 半小时清空历史 | 磁盘检查只读取使用量，不执行历史删除 | `retention.cjs` 验证永久保存的文字和音频仍存在 |
| R2 音频到期删除文字 | 新增 `deleteAudioByDuration()`，定时和手动音频清理共用它。等待文件删除后清空路径，保留文字行；失败的文件保留路径供下次重试 | `retention.cjs` 验证音频过期、纯文字、近期音频及独立历史保留策略 |
| R3 Koffi 回调泄漏 | 上下文和设备枚举共用回调生命周期。完成或绑定失败后注销；JavaScript 超时后仍保留指针，直到迟到的原生回调完成 | `native-callbacks.cjs` 连续执行超过槽位上限的查询，并检查超时、迟到回调、无效 JSON 和绑定失败 |
| R4 跳过删除确认 | 使用未筛选历史查询判断是否需要确认，重新启用有限期保存也走确认流程。确认后同步启用保存 | `history-retention-ui.cjs` 驱动真实 Electron 页面，覆盖空筛选、从不保存、取消和真正空历史 |
| R5 非整帧编码失败 | 最后一帧补零到合法帧长，编码延迟一并补齐；每段录音使用独立编码器并释放资源 | `opus.cjs` 覆盖任意尾帧、单样本、空输入、所有支持采样率、双声道和连续录音 |
| R6 Ogg/Opus 输出无效 | 写入独立标识页与注释页、页序号、校验和、48 kHz granule、pre-skip 与 EOS。历史解码依据 EOS 裁剪填充，同时保留无头旧格式读取行为 | `opus.cjs` 检查容器，并使用 macOS `afconvert` 独立解码验证准确样本长度 |
| R7 安装包缺少 SQL | 将 `resources/db/**/*` 纳入 `extraResources` | `packaged-db.cjs` 使用真实打包匹配规则复制 SQL，在无源码的隔离目录中执行实际数据库初始化和重启 |
| R8 worklet 验证旧路径 | 检查脚本改为根目录 `public/capture-worklet.js` | `npm run verify:voice` 完整通过 |
| R9 离线 UI 公共资源缺失 | 离线构建显式配置根目录 `publicDir` | `npm run verify:providers` 和 `npm run verify:ui` 完整通过 |

保留策略、原生回调和 Opus 新增检查均先在修复前失败，修复后通过。历史保留期界面检查先复现了空筛选时不出现确认弹窗，修复后通过。打包匹配与资源路径的修复前证据保留在首次审查报告中。

Ogg/Opus 的头部、48 kHz 时间基准及末尾裁剪依据 [RFC 7845](https://www.rfc-editor.org/rfc/rfc7845.html)。本次独立解码同时验证输出可读取及录音长度。

## 恢复完整 UI 验证后补齐的两处问题

语言切换检查发现中文“设置”的反向映射误用了引导流程的英文 `Set up`。设置页五个标题和导航现在使用明确的翻译键，键名受现有 locale 类型约束。原有 `Settings` 标题断言通过。

回答卡的 meta CSP 含有 Chromium 明确忽略的 `frame-ancestors` 指令，导致浏览器报告错误。移除该无效声明后，原有其余 CSP 保留，完整 UI 检查的浏览器错误列表为空。没有放宽或过滤检查脚本的错误断言。

## 本次命令结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过，保留原有非阻断构建警告 |
| `npm run verify:regressions` | 通过，包含内存 SQLite、原生回调、实际音频 Worker 和隔离数据库安装布局 |
| `npm run verify:voice` | 34 项通过，包含 worklet 与 Swift 回放 |
| `npm run verify:settings` | 7 项通过 |
| `npm run verify:providers` | 通过，包含传输、实时协议、Electron 设置及 IPC、16 张 Provider UI 截图和交互断言 |
| `npm run verify:ui` | 通过，22 张通用 UI 截图、浏览器错误为空，并通过 3 项历史保留期交互检查 |
| `git diff --check` | 通过 |

独立代码复审未发现本轮修改的阻断性问题，并复核了设置页明确翻译键的补充修改。

测试使用临时数据库、隔离用户目录、合成音频及本地供应商协议场景。没有读取真实用户历史、打开物理麦克风、发送真实键盘输入或请求付费供应商。

真实跨线程 FFI 回调、麦克风到目标输入框的完整过程，以及签名安装包实机运行仍需真机验收。本轮安装布局检查覆盖实际数据库代码和打包资源规则，不等同于签名安装包验收。现有历史音频文件没有批量重写。
