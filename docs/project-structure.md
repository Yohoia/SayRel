# OffKey 项目结构说明

## 项目概览

OffKey 是一个基于 Electron + React + TypeScript 的桌面应用程序，采用标准的三进程架构。

## 核心目录结构

```
offkey/
├── public/                    # 静态资源（标准 Vite 约定）
│   ├── assets/               # 图片资源
│   ├── fonts/                # 字体文件
│   └── capture-worklet.js    # Audio Worklet
│
├── src/
│   ├── main/                 # 主进程代码
│   │   ├── index.ts         # 应用入口
│   │   ├── services/        # 业务逻辑层
│   │   │   ├── providers/   # 服务提供商模块
│   │   │   ├── auth.ts
│   │   │   ├── transcription.ts
│   │   │   └── ...
│   │   ├── ipc/             # IPC 处理器
│   │   ├── lib/             # 工具库
│   │   ├── windows/         # 窗口管理
│   │   ├── workers/         # Worker 线程
│   │   └── db/              # 数据库层
│   │
│   ├── preload/             # 预加载脚本
│   │   ├── index.ts
│   │   └── bridges/         # 按功能分类的桥接
│   │
│   ├── renderer/            # 渲染进程代码，六个窗口 HTML 入口直接位于本目录
│   │   ├── shared/          # 共享资源
│   │   │   ├── components/  # 共享 React 组件
│   │   │   │   ├── Modal.tsx
│   │   │   │   ├── Toast.tsx
│   │   │   │   ├── Icons.tsx
│   │   │   │   ├── VoiceInstrument.tsx # 引导页线稿仪器
│   │   │   │   └── ConfirmDialog.tsx
│   │   │   ├── styles/      # 共享样式
│   │   │   │   ├── base.css
│   │   │   │   ├── home.css       # 首页与共享顶部导航
│   │   │   │   ├── hub.css
│   │   │   │   ├── secondary.css
│   │   │   │   ├── settings.css
│   │   │   │   ├── dictionary.css
│   │   │   │   ├── providers.css
│   │   │   │   └── feedback.css
│   │   │   ├── utils/       # 工具函数
│   │   │   │   ├── bridge.ts
│   │   │   │   ├── appearance.ts
│   │   │   │   ├── checkForUpdates.ts
│   │   │   │   └── providerApi.ts
│   │   │   └── reference-icons.json
│   │   │
│   │   ├── hub/             # 主窗口
│   │   │   ├── components/    # HubHeader、SettingsPanel 等
│   │   │   ├── pages/
│   │   │   ├── state/         # 共享录音状态订阅 recording.ts
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   │
│   │   ├── floating-bar/    # 浮动条窗口
│   │   │   ├── components/
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   └── styles.css
│   │   │
│   │   ├── login/           # 登录窗口
│   │   │   ├── components/
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   │
│   │   ├── onboarding/      # 引导窗口
│   │   │   ├── components/
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   │
│   │   ├── sidebar/         # 侧边栏窗口
│   │   │   ├── components/
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   │
│   │   └── interactive-card/ # 交互卡片窗口
│   │       ├── components/
│   │       ├── App.tsx
│   │       └── main.tsx
│   │
│   ├── shared/              # 跨进程共享代码
│   │   ├── types.ts
│   │   ├── settings.ts
│   │   ├── providers.ts
│   │   ├── ipc.ts
│   │   └── ...
│   │
│   └── test/                # 测试文件
│
├── resources/               # 构建资源
│   ├── build/              # 图标等构建资源
│   ├── lib/                # 原生库
│   ├── locales/            # 多语言文件
│   └── ...
│
├── scripts/                 # 构建和诊断脚本
│   ├── diagnostics/
│   └── ...
│
├── docs/                    # 文档
│   ├── adr/                # 架构决策记录
│   ├── agents/             # AI Agent 配置文档
│   └── ui-evidence/        # UI 验证截图
│
├── out/                     # 构建输出
│   ├── main/
│   ├── preload/
│   └── renderer/
│
├── electron.vite.config.ts  # Electron Vite 配置
├── tsconfig.json            # TypeScript 配置
├── package.json
└── README.md
```

## 架构说明

### 1. 进程分离

- **主进程 (Main)**: 负责应用生命周期、窗口管理、系统集成
- **渲染进程 (Renderer)**: 多个独立的 React 应用窗口
- **预加载脚本 (Preload)**: 使用 contextBridge 暴露安全的 API

### 2. 多窗口架构

OffKey 使用多窗口架构，每个窗口都是独立的 React 应用：

| 窗口 | 用途 | 入口文件 |
|------|------|----------|
| hub | 主界面（仪表板、历史、词典、设置） | `hub.html` |
| floating-bar | 浮动录音条 | `floating-bar.html` |
| login | 登录界面 | `login.html` |
| onboarding | 首次使用引导 | `onboarding.html` |
| sidebar | 侧边栏 | `sidebar.html` |
| interactive-card | 交互卡片 | `interactive-card.html` |

### 3. 共享代码组织

#### src/shared/
跨进程共享的类型定义、常量、业务逻辑：
- 类型定义（types.ts, ipc-types.ts）
- 设置模式（settings.ts）
- Provider 配置（providers.ts）
- IPC 协议（ipc.ts）

#### src/renderer/shared/
渲染进程之间共享的 UI 组件和工具：
- **components/**: React 组件（Modal, Toast, Icons, ConfirmDialog）
- **styles/**: CSS 样式文件
- **utils/**: 工具函数（bridge, theme, providerApi）

### 4. 构建系统

- **构建工具**: electron-vite（基于 Vite）
- **打包工具**: electron-builder
- **TypeScript**: 全栈类型安全
- **React**: 使用 React 18 + Hooks

### 5. 路径别名

```typescript
// tsconfig.json
{
  "paths": {
    "@shared/*": ["src/shared/*"],      // 跨进程共享
    "@main/*": ["src/main/*"],          // 主进程
    "@renderer/*": ["src/renderer/*"]   // 渲染进程
  }
}
```

## 开发规范

### 目录命名规范

- ✅ 使用 kebab-case: `floating-bar/`, `interactive-card/`
- ✅ 清晰的功能分类: `components/`, `pages/`, `utils/`, `styles/`
- ✅ 按进程分离: `main/`, `renderer/`, `preload/`, `shared/`

### 文件命名规范

- ✅ React 组件: PascalCase (`App.tsx`, `Modal.tsx`)
- ✅ 工具函数: camelCase (`bridge.ts`, `providerApi.ts`)
- ✅ 样式文件: kebab-case (`base.css`, `secondary.css`)
- ✅ HTML 入口: kebab-case (`hub.html`, `floating-bar.html`)

### 导入路径规范

```typescript
// ✅ 使用相对路径或路径别名
import { Modal } from '../shared/components/Modal'
import { Settings } from '@shared/settings'

// ✅ 样式导入明确路径
import '../shared/styles/base.css'

// ❌ 避免深层相对路径
import { Modal } from '../../../renderer/shared/components/Modal'
```

## 与标准 Electron 项目的对比

| 方面 | OffKey | 标准做法 | 符合度 |
|------|--------|----------|--------|
| 进程分离 | main/preload/renderer | ✅ 标准 | ⭐⭐⭐⭐⭐ |
| public 位置 | 项目根目录 | ✅ 标准 | ⭐⭐⭐⭐⭐ |
| 构建工具 | electron-vite | ✅ 现代化 | ⭐⭐⭐⭐⭐ |
| 多窗口 | 6 个独立窗口 | ✅ 合理 | ⭐⭐⭐⭐⭐ |
| CSS 组织 | styles/ 子目录 | ✅ 清晰 | ⭐⭐⭐⭐⭐ |
| 组件组织 | components/ 子目录 | ✅ 标准 | ⭐⭐⭐⭐⭐ |
| TypeScript | 严格模式 | ✅ 最佳实践 | ⭐⭐⭐⭐⭐ |

## 总结

OffKey 项目现在完全符合现代 Electron + React 项目的最佳实践：

✅ 清晰的进程分离架构\
✅ 标准的目录组织结构\
✅ 一致的命名规范\
✅ 良好的代码分层\
✅ 现代化的构建工具\
✅ 严格的 TypeScript 类型检查\

这种结构使得项目易于维护、扩展和团队协作。
