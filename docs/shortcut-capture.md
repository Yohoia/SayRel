# 快捷键编辑采集

对应 [Issue #4](https://github.com/Yohoia/SayRel/issues/4)。

`src/renderer/shared/shortcutCapture.ts` 集中订阅、启动、就绪前事件缓存、输入适配和幂等释放。编辑器继续负责草稿显示、冲突校验、重置、绑定数量和保存。原生适配器保留 Fn、左右修饰键和受支持鼠标按键；浏览器适配器仅使用浏览器实际报告的键盘能力。

主进程仍是采集所有权的唯一来源。每次启动返回会话 ID，事件和结束请求均携带该 ID；其他窗口或旧会话不能结束新会话。失焦、渲染进程退出、初始化失败和正常结束均释放订阅，并恢复此前录音禁用状态与快捷键注册。

编辑退出立即拒绝后续事件；启动结果晚到时释放对应旧会话。重复释放事件只保存一次，旧保存结果不会关闭下一轮编辑。练习入口本阶段仅适配会话 ID 协议，共享模块迁移留给 #5。

## 验证记录

2026-10-23，在临时用户目录与离线 fixture 中验证；未使用真实麦克风或供应商服务。

- `verify:settings`：通过，包含就绪前事件、浏览器组合键、重复结束、旧会话隔离、所有权及初始化失败恢复。
- `verify:ui`：通过，包含真实编辑入口的两个适配器、初始化中 Escape/关闭、晚到结果、窗口失焦和焦点移出后立即到达事件、重复保存、冲突重试、重置及绑定数量约束。修正了既有界面检查遗漏“System permissions”分组的断言。
- 其余 `verify:*` 中 voice、permissions、microphone、brand、providers、home、hero、activity、language、floating、typeless 全部通过。
- `verify:regressions`：既有 retention 加载器无法解析 `../../shared/usage`，首项失败。被短路跳过的 native-callbacks、opus、packaged-db 已分别运行，全部通过。
- `typecheck`、生产 `build`：通过。
- 额外 `feature-tour.cjs`：三个完整练习课程及清理检查通过。
- `code-review`：Standards 两项接口与类型建模问题已修正；Spec 复审指出的焦点移出清理时序已修正，并补充回归测试。

上述检查不代替真实硬件上的原生按键冒烟验证。
