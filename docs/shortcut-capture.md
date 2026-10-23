# 快捷键编辑与练习采集

对应 [Issue #4](https://github.com/Yohoia/SayRel/issues/4) 与 [Issue #5](https://github.com/Yohoia/SayRel/issues/5)。

`src/renderer/shared/shortcutCapture.ts` 集中订阅、启动、就绪前事件缓存、输入适配和幂等释放。编辑器继续负责草稿显示、冲突校验、重置、绑定数量和保存。原生适配器保留 Fn、左右修饰键和受支持鼠标按键；浏览器适配器仅使用浏览器实际报告的键盘能力。

主进程仍是采集所有权的唯一来源。每次启动返回会话 ID，事件和结束请求均携带该 ID；其他窗口或旧会话不能结束新会话。失焦、渲染进程退出、初始化失败和正常结束均释放订阅，并恢复此前录音禁用状态与快捷键注册。

编辑退出立即拒绝后续事件；启动结果晚到时释放对应旧会话。重复释放事件只保存一次，旧保存结果不会关闭下一轮编辑。功能练习使用同一采集模块，等价比较继续由练习负责，保存和冲突规则继续由编辑器负责。

练习在失焦时立即释放，聚焦后创建新采集；后台收到绑定变更时等待窗口聚焦。旧初始化、事件和错误均不能影响新入口。练习只拦截与保存绑定匹配的浏览器按键，保留 Tab 导航；编辑仍拦截采集中的所有有效按键。两个入口不再各自处理 IPC 订阅、就绪缓存、输入适配或会话 ID。

## #4 验证记录

2026-10-23，在临时用户目录与离线 fixture 中验证；未使用真实麦克风或供应商服务。

- `verify:settings`：通过，包含就绪前事件、浏览器组合键、重复结束、旧会话隔离、所有权及初始化失败恢复。
- `verify:ui`：通过，包含真实编辑入口的两个适配器、初始化中 Escape/关闭、晚到结果、窗口失焦和焦点移出后立即到达事件、重复保存、冲突重试、重置及绑定数量约束。修正了既有界面检查遗漏“System permissions”分组的断言。
- 其余 `verify:*` 中 voice、permissions、microphone、brand、providers、home、hero、activity、language、floating、typeless 全部通过。
- `verify:regressions`：既有 retention 加载器无法解析 `../../shared/usage`，首项失败。被短路跳过的 native-callbacks、opus、packaged-db 已分别运行，全部通过。
- `typecheck`、生产 `build`：通过。
- 额外 `feature-tour.cjs`：三个完整练习课程及清理检查通过。
- `code-review`：Standards 两项接口与类型建模问题已修正；Spec 复审指出的焦点移出清理时序已修正，并补充回归测试。

上述检查不代替真实硬件上的原生按键冒烟验证。

## #5 验证记录

2026-10-23，沿用已确认的编辑与练习行为入口，在生产 React 组件的离线构建上验证。

- `verify:tour`：新增常规命令，运行既有 `feature-tour.cjs`。三个完整课程通过；新增检查覆盖浏览器右 Shift 与方向键在编辑保存后被练习识别、左右 Shift 区分、native Fn 组合升级、鼠标绑定、通用 Shift 绑定与带侧别的原生输入匹配，以及 Tab 导航。
- 交接检查：编辑和练习初始化未完成时分别切到另一入口；旧初始化、事件和结束请求不能影响新采集。就绪前的有效 native 输入在就绪后交付；离开步骤、失焦、退出课程立即移除订阅。旧课程晚到的失败不能显示到新课程。
- 焦点检查：失焦后立即到达的事件被忽略；初始化期间失焦也释放晚到会话。聚焦后只启动一次新采集；初始化失败可在重新聚焦时重试；后台收到绑定更新不会重新启动采集。
- `verify:settings`、`verify:ui`、`verify:tour`、`typecheck` 与生产 `build` 均通过。主进程所有权、先前禁用状态、快捷键恢复和崩溃清理由既有设置诊断继续覆盖。
- 完整运行全部 15 项 `verify:*`：14 项通过。`verify:regressions` 仍因既有 retention 加载器无法解析 `../../shared/usage` 而失败；被短路跳过的 native-callbacks、opus、packaged-db 分别补跑通过。
- 以 `699c74a` 为基点执行双轴代码审查：Standards 0 项，Spec 0 项。

本阶段未调用真实麦克风、供应商或用户配置；原生输入通过受控适配器验证。
