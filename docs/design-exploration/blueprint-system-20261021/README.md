# Offkey 全应用：灰白纸面与 Hermes 蓝字

用户已选第二版首页的构图与交互，并要求扩展至整个项目；最新将配色改为灰白背景、Hermes 蓝色主文字。当前规范以根目录 [DESIGN.md](../../../DESIGN.md) 为准。

- 当前背景 `#F2F2F2`，主文字 `#0000C2`；系统深色偏好不反转品牌配色。蓝色来源：项目内 Hermes 设计参考。此前蓝底方案由用户最新取舍覆盖。
- 保留三行展示标题、精密星盘、虚线快捷键、应用邮票与录音反馈；星盘只作为首页主视觉，其余页面以清单、索引和仪器控件延续设计。
- 全部主窗口页面共享顶部导航。历史、词典、服务商、设置、菜单、编辑/确认弹窗、登录、首次引导、回答卡、上下文窗口、悬浮条及 Toast 同步迁移。
- 颜色、字体、线条、圆角和交互反馈来自共享变量；移除旧 SideNav 和未使用的 theme.ts。没有保留第二套业务页面。
- Offkey 与第三方服务商标志保留原始资产，使用衬底保证灰白界面上的辨识度。商业 Rules 字体未分发，英文标题使用本机窄体替代，等宽部分使用本地 JetBrains Mono。

## 截图

| 页面 | 当前版本 | 改版前 |
| --- | --- | --- |
| 首页 | [当前首页](after/dashboard.png) | [原版本](before/dashboard.png) |
| 历史 | [清单](after/history.png) | [原版本](before/history.png) |
| 词典 | [词典](after/dictionary.png) | [原版本](before/dictionary.png) |
| 服务商 | [服务商](after/providers.png) | [原版本](before/providers.png) |
| 设置 | [设置](after/settings.png) · [小窗口](after/settings-small.png) | [原版本](before/settings.png) |
| 登录 | [登录](after/login.png) | [原版本](before/login.png) |
| 引导 | [权限](after/onboarding-permissions.png) · [麦克风](after/onboarding-microphone.png) · [快捷键](after/onboarding-shortcut.png) | [原版本](before/onboarding-permissions.png) |
| 回答卡 | [回答卡](after/answer-card.png) | [原版本](before/answer-card.png) |
| 上下文 | [检查器](after/context-sidebar.png) | [原版本](before/context-sidebar.png) |
| 悬浮条 | [录音](after/floating-recording.png) · [免提](after/floating-hands-free.png) · [整理](after/floating-hands-free-dictating.png) | [原版本](before/floating-recording.png) |

`before/` 与 `after/` 使用相同视口和离线 fixture。主窗口1080×750，设置另有840×560，回答卡800×500，上下文350×500。原生交通灯由系统提供，离线截图不伪造窗口按钮。

## 验证与边界

`capture.cjs` 检查30个页面/状态的资源加载、横向溢出和渲染错误，报告见 [after/report.json](after/report.json)。交互检查沿用项目的 `ui-offline`、`history-retention-ui`、`providers-ui`、`feedback-ui` 与首页 `scripts/diagnostics/home-ui.cjs`。异步脚本连续运行三次，最终结果另见 [verification.json](verification.json)。

所有检查使用临时配置、阻断网络与离线数据；不读取真实账户或历史，不调用真实供应商或麦克风。保存、失败重试、键盘焦点、删除取消、外观切换和路由均通过真实页面入口操作，但不代表真实语音端到端已验收。

动效保留入场、导航下划线、快捷键随焦点高亮、按压、应用箭头、录音呼吸、弹窗与悬浮条状态变化；遵循减少动态效果。没有为内容清单添加持续转动的装饰。

## 设计取舍与评审

按已确认规范迁移，不重新探索方向。已有界面润色评审一轮，不打分；评审记录见 [review.md](review.md)。保留技术等宽编号和虚线是为了延续选定的仪器排印语法；首页左右构图是用户已选择的方案。星盘微刻度和印章编号属于装饰信息，可小于正文；必要说明和控件辅助文字不小于13px。

文案移除颜色指代造成的误导（麦克风测试改称音量条），保留功能名称、当前状态和失败恢复说明。历史还原记录保留用于追溯，并明确链接当前规范。

取证工具静态截图和200%局部成功，唯一默认做法提示为 `p.home-eyebrow「VOICE INTO WORDS」` 标题上方眉标，按已选技术署记保留。工具动效探测报 `__oilMotion` / `__oilRecordTiming` 未定义，且系统缺少 ffmpeg；保留采样帧，不宣称连续录屏与动效手感独立验收。Electron 状态与减少动态效果交互检查通过。

最新配色微调：主文字改为 `#0000C2`、背景 `#F2F2F2`，已同步全部窗口、星盘与按钮反色。更新 `after/` 全30张截图及README产品截图，类型检查、首页交互与消息/确认反馈检查重新通过。上述三轮回归及独立评审属于此前迁移；本次确定色值的调整做相邻状态检查，未重新派发独立评审。本地 `browser-evidence/` 保留此前蓝底版本的工具取证（不纳入版本控制），当前视觉以 `after/` 为准。
