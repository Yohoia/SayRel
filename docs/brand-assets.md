# Sayrel：字体、英文界面与品牌素材

更新：2026-10-22

## 当前约定

应用显示名称为 Sayrel，新安装界面默认英文，可在设置中切换中文。整体沿用 Hermes 的本地 Rules 字体、灰白背景 `#F2F2F2` 与蓝色文字 `#0000C2`；首页以居中排印与语音转写演示动画为主视觉，使用统计移至独立统计页。

品牌Slogan为 `Speak more. Type less.`，交互理念为 `Hold to speak.`，核心定位为 `AI-powered voice typing`，品牌理念为“让表达像说话一样自然”。首页主标题中文为「开口只管随心，落笔自有逻辑。」，英文为 `Speak freely. Write brilliantly.`；副标题分行为品牌定位与功能说明。现有快捷键配置与录音模式继续按用户设置执行。

产品名称、npm 包名、应用标识、IPC、URL scheme、导出文件名与文档已统一为 Sayrel / sayrel。应用标识为 `com.sayrel.app`，IPC 桥接为 `window.sayrel`，URL scheme 为 `sayrel`。GitHub 仓库地址以 `git remote -v` 为准。

新安装使用 Sayrel 数据目录与 `sayrel.db`。已有安装在启动时优先复用包含设置或数据库的旧数据目录，并兼容原数据库文件名；不复制或移动用户数据，保持录音绝对路径和设置文件可读。旧名称只出现在兼容读取逻辑、对应测试与历史验收日志路径中。旧版云服务设置枚举在读取时转换为 `sayrel-cloud`。

## 字体

字体通过 `src/renderer/shared/styles/base.css` 的 `@font-face` 从项目本地加载；无须在操作系统安装，也不需要运行时请求字体 CDN。

| 字体 | 位置 | 用途 |
| --- | --- | --- |
| Rules Gothic Condensed，300 / 400 / 500 | `public/fonts/hermes/RulesGothicCnd-*.woff2` | Sayrel 字标、首页英文标题与展示键帽、业务页面展示标题、统计数字 |
| Rules Gothic Compressed，400 / 500 / 600 | `public/fonts/hermes/RulesGothicCmp-*.woff2` | 本地压缩展示字体，随字体清单保留 |
| Rules Variable | `public/fonts/hermes/RulesVariable.woff2` | 顶部导航，使用 `font-stretch:50%` |
| Inter，可变字重 | `public/fonts/hermes/Inter-latin-variable.woff2` | 英文正文、表单、设置及操作文案 |
| JetBrains Mono | `public/fonts/home-mono.woff2` | 快捷键、时间、刻度、编号及技术信息 |
| MiSans，Regular / Medium | `public/fonts/misans/MiSans-*.woff2` | 全部窗口的主要中文字体（首页中文主标题除外）；正文与标题使用 Regular，小标签与操作使用 Medium |
| 南西初夏宋，常规 400 | `public/fonts/nanxi-chuxia-song/NanxiChuxiasong-Regular.woff2` | 首页中文主标题展示字体 |

MiSans 从[小米官方下载页](https://hyperos.mi.com/font/zh/download/)获取，直接使用官方 WOFF2，保留完整字库，不修改字体文件。Regular 与 Medium 分别以 CSS 400、500 声明，使用真实字重；字体原始元数据的权重值分别为 330、380。版本为 4.009，两款各含 29,571 个 Unicode 映射，当前界面和中文翻译的汉字均已覆盖。下载地址、原始文件哈希、版权声明与许可协议 PDF 随字体保存在 `public/fonts/misans/`；“设置 → 关于”展示 MiSans 使用声明与许可链接。

共享 `--font-chinese` 指向 MiSans，加入正文、展示、导航与等宽字体栈，覆盖输入框、弹窗及独立悬浮条；不依赖界面语言，因此英文界面中的中文用户内容同样生效。字体限定用于汉字、中文标点与全角字符，英文仍使用 Rules、Inter、JetBrains Mono；生僻字缺字时回退系统字体。

中文正文与标题使用正常字形尺寸，分别以 `--tracking-chinese-body:.02em` 和 `--tracking-chinese-title:.01em` 设置字距。正文和标题用 Regular，小字、统计标签和操作用 Medium，不再对正文合成加粗。中文次级文字保留 85% 蓝色不透明度；首页中文主标题行高 1.2，保持两行。

南西初夏宋的原始 TTF、完整 WOFF2、作者商用许可 PDF、OFL 和来源清单全部保留在 `public/fonts/nanxi-chuxia-song/`。其 `@font-face` 声明保留，首页中文主标题按字体名称显式使用；其余中文场景仍为 MiSans。此前排版截图保存在 `docs/design-exploration/chinese-typography-20261021/`。

Rules 来自 [Hermes Agent](https://hermes-agent.nousresearch.com/) 当前参考采集中的 Nous 官方公开字体资源；Inter 来自同一参考样式引用的 Google Fonts。逐文件下载地址与哈希见 `public/fonts/hermes/sources.json`。JetBrains Mono 沿用已有本地文件。

Inter 和 JetBrains Mono 的 OFL 授权随文件保留。Rules 字体的公开下载地址不代表项目已获得应用嵌入或再分发授权；当前仓库中没有对应授权证明，发布安装包前需要核对授权。没有引入参考站中的 Aeonik Fono Pro TRIAL。

## Logo 的选择与安装

素材来源：用户提供的 `~/Desktop/Sayrel-logo/` 的 Fixed V2 版本。macOS、Windows、Linux、favicon 与托盘素材按原尺寸直接安装，导入前校验素材包 manifest 的哈希。macOS 原图已包含 100px 透明边距，不再二次缩小。

| 场景 | 来源 | 项目位置 |
| --- | --- | --- |
| macOS 安装包 | `application-icons/mac/icon.icns` | `resources/build/icon.icns` |
| Windows 安装包 | `application-icons/win/icon.ico` | `resources/build/icon.ico` |
| macOS Dock | `application-icons/mac/Sayrel.iconset/icon_512x512@2x.png`（1024px） | `resources/build/mac-icon.png` |
| Linux应用图标 / 原始PNG母版 | `application-icons/png/1024x1024.png` | `resources/build/icon.png` |
| macOS 菜单栏 | `tray/tray.png`、`tray/tray@2x.png` | `resources/build/` 同名文件 |
| Windows 托盘 | `tray/tray-win32.png`、`tray/tray-win32@2x.png` | `resources/build/` 同名文件 |
| Linux 托盘 | `tray/tray-blue-32.png` | `resources/build/tray-linux.png` |
| 顶栏、设置侧栏、引导页、回答卡 | `logos/sayrel-symbol.svg` + 本地 Rules Gothic Condensed | 共享 `BrandLockup` 组件，28px 图标、36px 字号与行高；按实际字形高度调整图文比例 |
| 后续组合与矢量源文件 | `logos/sayrel-symbol.svg`、`sayrel-wordmark.svg`、`sayrel-app-icon.svg` | `public/assets/brand/` 同名文件 |
| Renderer 页面 favicon | `favicon/favicon.svg`、`favicon/favicon.ico` | `public/favicon.svg`、`public/favicon.ico` |

macOS 使用黑色透明模板并调用 `setTemplateImage(true)`，保留 `@2x` 的多分辨率表示。蓝色图标用于 Windows / Linux 等非模板场景。新版横版与字标 SVG 使用文本并带有留白，因此应用界面使用共享组件，以项目已有的本地 Hermes Rules 渲染小写 sayrel，避免外部 SVG 字体差异与画布留白造成比例失衡。横版和字标原始素材仍保留在品牌目录中。

素材来源、尺寸和哈希索引见 `public/assets/brand/manifest.json`。

使用 `npm run icons -- /path/to/Sayrel-logo` 可重新导入完整素材（默认读取桌面的 Sayrel-logo）。`npm run icons:mac` 仅用于从当前内置 PNG 重建 macOS 多尺寸图标，保留素材已有的透明留白。macOS ICNS 包含 16、32、128、256、512 逻辑尺寸的 1× / 2× 档位；Windows ICO 包含 16–256px 档位，favicon ICO 包含 16 / 32 / 48px 档位。Renderer 另引用 16px、32px PNG、SVG 和 180px Apple touch icon。
