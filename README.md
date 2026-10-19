# OffKey

基于 Electron、React、TypeScript 和 Swift 的 macOS 语音输入应用，支持口述、翻译、问答、历史记录和词典。

## 本地运行

需要 macOS、Node.js 22 或更新版本、npm 10 或更新版本，以及 Xcode Command Line Tools。

```bash
npm ci
npm run native
npm run dev
```

首次运行需要授予麦克风和辅助功能权限。真实转写、翻译与问答需要可用的模型服务配置；仓库不包含密钥或用户账户数据。

## 检查与构建

```bash
npm run typecheck
npm run verify:voice
npm run verify:settings
npm run build
```

界面离线验收：`npm run verify:ui`。macOS 打包：`npm run dist:mac`。原生动态库由 `npm run native` 从 Swift 源码生成。

## 项目结构

```text
src/
  main/        Electron 主进程、IPC、语音服务、数据库和窗口
  preload/     主进程与渲染进程通信桥接
  renderer/    React 页面、组件、样式和运行素材
  shared/      类型、常量、设置模型和 IPC 定义
swift/         macOS 原生键盘、输入、上下文和设备助手
resources/     图标、语言包及其他运行资源
scripts/       原生构建、回归检查和界面验收脚本
docs/          实现记录、参考依据和已知差异
```

依赖、生成文件、缓存、原版参考包、验收截图和本地凭据由 `.gitignore` 排除。项目的当前实现范围与未完成项见 [接续记录](docs/continuation-status.md) 和 [设置页对齐说明](docs/settings-parity.md)。
