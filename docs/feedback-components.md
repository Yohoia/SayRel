# 消息与确认组件

组件直接应用到业务入口。`ToastViewport` 已挂载到主窗口、登录、引导、回答卡和上下文窗口。每个 Electron 窗口内的消息独立显示。

## Toast

从 `src/renderer/shared/Toast.tsx` 导入 `toast`。所有类型使用黑底白字胶囊，只显示一句消息。成功消息左侧带对勾，进行中消息左侧带加载指示。

```tsx
toast.success('保存成功')
toast.error('连接失败，请检查 API Key')
toast.info('请先选择一个模型')

const id = toast.loading('正在检查更新')
toast.update(id, { tone: 'success', message: '已是最新版本' })
toast.dismiss(id)
```

成功和普通提示默认显示 3.6 秒，错误显示 6.5 秒。鼠标悬停或键盘聚焦时暂停计时，聚焦后可按 Esc 关闭。相同消息合并，最多显示三条。

进行中提示不会自动消失。异步操作应在成功和失败分支调用 `update` 或 `dismiss`。需要改变显示时间时，使用 `toast.show({ tone: 'info', message: '提示内容', duration: 5000 })`。

操作结果和输入校验统一使用 Toast，不在页面、表单、模型行或确认框中追加重复提示。保留按钮的处理中状态、当前默认模型等持续状态，以及数据加载失败后的重试入口。

## 二次确认

从 `src/renderer/shared/ConfirmDialog.tsx` 导入 `ConfirmDialog`。父组件负责执行操作、维护 `pending`，并在成功后关闭弹窗。

```tsx
<ConfirmDialog
  title="确认删除这条记录？"
  description="删除后无法恢复。"
  subject={record.refinedText}
  pending={deleting}
  onConfirm={() => void removeRecord()}
  onClose={() => setConfirming(false)}
/>
```

左右按钮固定为「取消」「确认」。`subject` 可提供删除对象的名称或摘要。长摘要最多显示三行，完整内容保留在无障碍描述与鼠标提示中。

取消按钮默认获得焦点。提交期间禁用按钮、Esc 和遮罩关闭。失败后通过 `toast.error` 提示、清除 `pending` 并保留弹窗供重试。

表单与详情继续使用 `Modal.tsx`，二次确认使用 `ConfirmDialog`。

## 业务入口

- 服务商配置保存、验证、模型发现、默认模型与移除配置。
- 词典添加、编辑、导入和删除。
- 历史记录复制、重试、下载和删除。
- 设置保存、检查更新和退出账户。
- 登录失败、引导权限错误、回答卡与上下文窗口复制。

## 验证

```sh
node scripts/ui-build.mjs
./node_modules/.bin/electron scripts/diagnostics/feedback-ui.cjs
./node_modules/.bin/electron scripts/diagnostics/providers-ui.cjs
```

验收通过真实页面入口驱动操作，使用临时配置和离线数据。当前截图与检查结果保存于 `docs/ui-evidence/feedback-minimal/`，不验证真实登录、模型服务或更新下载。

完整界面脚本 `ui-offline.cjs` 有既有的英文设置标题断言失败：按中文文案反查翻译键时，「设置」命中了引导页的 `Set up`，脚本预期 `Settings`。本次没有修改该翻译映射。
