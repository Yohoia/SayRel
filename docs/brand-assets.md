# Sayrel：字体、英文界面与品牌素材

更新：2026-10-21

## 当前约定

应用显示名称为 Sayrel，界面默认英文。沿用灰白背景 `#F2F2F2` 与蓝色文字 `#0000C2`，保持已确认的星盘、排版和快捷键交互。

品牌Slogan为 `Speak more. Type less.`，交互理念为 `Hold to speak.`，核心定位为 `AI-powered voice typing`，品牌理念为“让表达像说话一样自然”。首页使用两行Slogan、定位眉标与英文理念文案；交互理念在星盘图注呈现，现有快捷键配置与录音模式继续按用户设置执行。

仓库名称、npm 包名、bundle ID、IPC、URL scheme 和本地数据库文件名继续使用 Offkey 标识，以免这次素材替换改变已有配置和集成。

## 字体

字体通过 `src/renderer/shared/styles/base.css` 的 `@font-face` 从项目本地加载；无须在操作系统安装，也不需要运行时请求字体 CDN。

| 字体 | 位置 | 用途 |
| --- | --- | --- |
| Rules Gothic Condensed，300 / 400 / 500 | `public/fonts/hermes/RulesGothicCnd-*.woff2` | 首页及业务页面展示标题 |
| Rules Gothic Compressed，400 / 500 / 600 | `public/fonts/hermes/RulesGothicCmp-*.woff2` | 本地压缩展示字体，随字体清单保留 |
| Rules Variable | `public/fonts/hermes/RulesVariable.woff2` | 顶部导航，使用 `font-stretch:50%` |
| Inter，可变字重 | `public/fonts/hermes/Inter-latin-variable.woff2` | 英文正文、表单、设置及操作文案 |
| JetBrains Mono | `public/fonts/home-mono.woff2` | 快捷键、时间、刻度、编号及技术信息 |

Rules 来自 [Hermes Agent](https://hermes-agent.nousresearch.com/) 当前参考采集中的 Nous 官方公开字体资源；Inter 来自同一参考样式引用的 Google Fonts。逐文件下载地址与哈希见 `public/fonts/hermes/sources.json`。JetBrains Mono 沿用已有本地文件。

Inter 和 JetBrains Mono 的 OFL 授权随文件保留。Rules 字体的公开下载地址不代表项目已获得应用嵌入或再分发授权；当前仓库中没有对应授权证明，发布安装包前需要核对授权。没有引入参考站中的 Aeonik Fono Pro TRIAL。

## Logo 的选择与安装

素材来源：用户提供的 `~/Desktop/sayrel-logo/`。界面、Windows / Linux与托盘素材直接复制；macOS应用图标按Typeless实物的透明留白比例重新生成，标志形状与配色沿用提供的母版。

| 场景 | 来源 | 项目位置 |
| --- | --- | --- |
| macOS 安装包 | PNG母版经 `scripts/gen-mac-icons.swift` 生成 | `resources/build/icon.icns` |
| Windows 安装包 | `application-icons/win/icon.ico` | `resources/build/icon.ico` |
| macOS Dock | PNG母版经 `scripts/gen-mac-icons.swift` 生成 | `resources/build/mac-icon.png` |
| Linux应用图标 / 原始PNG母版 | `application-icons/png/1024x1024.png` | `resources/build/icon.png` |
| macOS 菜单栏 | `tray/tray.png`、`tray/tray@2x.png` | `resources/build/` 同名文件 |
| Windows 托盘 | `tray/tray-win32.png`、`tray/tray-win32@2x.png` | `resources/build/` 同名文件 |
| Linux 托盘 | `tray/tray-blue-32.png` | `resources/build/tray-linux.png` |
| 顶栏、设置侧栏、引导页、回答卡 | `logos/sayrel-horizontal.svg` | `public/assets/brand/sayrel-horizontal.svg` |
| 后续组合与矢量源文件 | `logos/sayrel-symbol.svg`、`sayrel-wordmark.svg`、`sayrel-app-icon.svg` | `public/assets/brand/` 同名文件 |
| Renderer 页面 favicon | `favicon/favicon.svg`、`favicon/favicon.ico` | `public/favicon.svg`、`public/favicon.ico` |

macOS 使用黑色透明模板并调用 `setTemplateImage(true)`，保留 `@2x` 的多分辨率表示。蓝色图标用于 Windows / Linux 等非模板场景。桌面素材包中的字标已转为路径，不依赖系统字体；它是素材包提供的近似字形，不是 Rules 正版字标。

素材来源、尺寸和哈希索引见 `public/assets/brand/manifest.json`。旧 Offkey 界面 Logo 已删除。

macOS图标修复：原PNG的圆角底板铺满1024×1024画布，而Typeless的PNG及ICNS最大档位均将824×824图形放在1024×1024画布中央，四周各留100px透明边距。现在Dock单独读取 `mac-icon.png`，macOS安装图标按同一比例生成16、32、128、256、512逻辑尺寸的1× / 2×档位。使用 `npm run icons:mac` 可从项目内PNG母版重建两者，并更新素材索引。重启应用后Dock会读取新PNG，安装包需重新生成才能使用新ICNS。

## 英文界面

首页、历史、词典、服务商、设置、引导、悬浮条、回答卡、上下文侧栏、原生菜单和应用自有错误提示使用英文。图片中的星盘注释也改为英文。

`DEFAULT_SETTINGS.language` 为 `en`。旧配置首次启动本版本时仅迁移界面语言到英文，保存 `interfaceLanguageVersion:1`；之后的语言选择继续保留。设置的已有多语言资源继续可用，当前改动没有补齐其他页面的多语言切换。

界面语言与识别 / 翻译语言相互独立：中文识别能力、中文语言变体、翻译目标和用户已有文本不随界面翻译而修改。

## 验证入口

- `npm run typecheck`：类型检查。
- `npm run verify:brand`：构建隔离 UI fixture，核对字体与品牌文件的尺寸和哈希，验证五个字体家族断网加载、应用 / 托盘图标和五个英文独立窗口状态。
- `node scripts/ui-build.mjs`：构建隔离 UI fixture，不请求真实服务。
- `electron scripts/diagnostics/home-ui.cjs`：断网加载五个本地字体家族、英文首屏、Logo、快捷键、统计与响应式布局。
- `electron scripts/diagnostics/ui-offline.cjs`：业务页面、设置语言切换和独立窗口。
- `npm run verify:providers`：包含临时配置目录中的旧配置英文迁移、后续语言选择、翻译目标、自定义快捷键与凭据保留检查，并覆盖本地服务商传输和界面交互。

本轮截图和检查报告写入已忽略的 `docs/ui-evidence/`；已接受设计记录的 `after/` 也更新为英文 Sayrel 界面。README 展示图同步更新。截图验证不代替真实麦克风、模型服务或安装包验收。

本轮已通过类型检查、7项设置快捷键检查、服务商配置与35项本地传输检查、21项本地实时协议检查、旧配置迁移与凭据读回检查，以及首页、设置与独立窗口、服务商、反馈弹窗和历史保留策略的界面检查。引导、上下文侧栏和回答卡另有断网截图；macOS菜单栏模板的16px / 32px表示已实际读取验证。发布安装包和真实外部服务未在本轮验收。

接续收尾：五组异步界面检查（首页、设置与独立窗口、服务商、反馈弹窗、历史保留）在最终修改后各连续通过三轮，结果保存在已接受设计记录的 `verification.json`。补齐回答卡英文示例及离线错误文案，更新全应用截图与两张README展示图。本次由主Agent查看代表性截图，字体、品牌与文案收尾没有另开独立视觉评审。

最新窗口与无账户收尾已完成：快捷键使用文字，修复Fn179并迁移旧配置；移除登录素材后品牌清单为15个文件。窗口适配、账户删除及最新验证结果见设计记录verification.json。
