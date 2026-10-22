# 首页 Wispr Flow hero 动画移植

## 源码依据

用户提供的只读镜像：桌面 `Whisper Flow/wisprflow-rebuild/mirror`，2026-10-22 快照。
本次只移植首页动画，继续使用 Sayrel 的 Electron / React / TypeScript / Vite。

- `index.html` 的 `.hero_animation-wrapper-v2`：两条 SVG 曲线、原始文本、35s / 60s SMIL 线性循环；左侧 viewBox 1048×594，右侧 1024×620。
- `flowsite-dev.webflow.shared.c87dafbc0.min.css`：desktop `.hero_animation-wrapper-v2` scale(1.5)、bottom center 原点；两侧各占 50%；left margin-top -9px；18px / 600 Figtree 文本；Lottie 宽 11%、bottom 2.5%；中央 blur(5px) 背板。
- `683e1e4368e08951ef7080d5_Flow header animation_toasts_trimmed v2.lottie`：完整中央动画，269×161、30fps、1388 帧（46.2667s）。含 23 根波形、their→they’re、Saved name、Removed Umm、Added question mark、Split sentence、Removed repetition 及其矢量文字、删除线和气泡。
- `webflow.schunk.f2efb3c5440a81cf.js`：源站内置 lottie-web 5.13.0。本项目使用同版 npm 播放器。

## 实现边界

中央动画使用原始 JSON。源数据唯一的 AE 表达式是波形时间重映射的 `loopOut()`，通过同步工具展开为原周期 72.999 帧的线性关键帧，使用同版 SVG 播放器；跳变以十亿分之一帧表示，以兼容 Electron 现有 CSP，不启用 unsafe-eval。其余关键帧与编辑时间轴不变。原始 glyph outlines 和缓动保留。按用户配色要求，渲染层使用项目 `--accent` 主题蓝：文字带、波形、边框、编辑文字与气泡统一为蓝色，胶囊使用 `--paper-elevated`，反白文字使用 `--accent-ink`。原始 Fill 滤镜在显示层禁用，避免覆盖主题色；原始数据与遮罩不修改。SVG 文字仅保留原文一次，与镜像一致。Figtree SemiBold 供两侧文字使用，所有资源均随应用离线打包。

有意适配：保留 Sayrel 标题、介绍、导航、快捷键和底部内容；动画画布锚定现有首页中间区域，保持 SVG 自身比例，不把曲线纵向拉扁。按用户后续反馈，压缩文字与动画之间的留白，让标题下移、动画上移；中文标题两行左右错位；副标题两侧添加蓝色细线声纹。后续微调保持动画位置，根据实际胶囊底部与页脚分隔线的位置，将快捷键垂直居中，保持上下留白相等；ResizeObserver 适配窗口与语言变化。路径可向上延伸到标题两侧；窄窗口使用镜像的断点比例。中央下载链接改为本地暂停/继续按钮，不触发录音。窗口不可见、路由离开、动画离开视口或系统要求减少动态效果时停止播放，卸载时销毁播放器。演示文字保留源站英文，按钮说明使用现有本地化。

## 素材

Lottie 动画、演示文本及 Figtree 字体来自用户提供的 Wispr 镜像；动画与文本归原作者。本次接入为本地项目修改，未发布网站。同步工具记录原始 SHA-256 并提供 `--check`，不改动镜像。

## 验证

- `python3 scripts/sync-wispr-hero.py "/path/to/mirror" --check`：原始 JSON、派生运行数据、两侧 SVG 参数与字体逐字节检查。
- `node scripts/ui-build.mjs && electron scripts/diagnostics/wispr-hero.cjs`：原始表达式（full player）与生产 React 组件（SVG player）在 34 个源帧比较可见 SVG。忽略节点属性顺序、运行时生成 ID 与隐藏图层；几何按原播放器 Float32 的 4 ULP 精度比较。覆盖六组编辑和循环接缝，检查暂停/恢复、SMIL 暂停、减少动态效果、离开与返回路由、离线无外联。
- `electron scripts/diagnostics/home-fit.cjs`：中英文 × 6 种桌面尺寸，检查单屏、无重叠和最小动画高度，生成实际 Electron 截图。
- 截图：`docs/ui-evidence/home-fit/`；关键帧与报告：`docs/ui-evidence/wispr-hero/`。

最终检查（2026-10-22）：TypeScript、生产构建、首页完整离线回归、34 个源帧对比及中英文 12 组桌面尺寸布局检查全部通过。用户要求的构图精修已在实际截图中自检；未做独立设计评审。可运行 `npm run verify:hero` 复验本次动画与布局。

主题配色复查：修正通用 fill/stroke 规则的特异性，浅色胶囊底与反白文字可以覆盖主题蓝；遮罩保持原样。声纹对比检查与中英文 12 组窗口的快捷键上下等距检查通过。
