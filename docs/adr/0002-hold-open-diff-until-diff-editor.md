# 0002 diff 编辑器到位之前，挂起插件的 open_diff 请求

- 状态：已采纳（2026-10-08），M2 做完 diff 标签页后改为真实实现

## 背景

插件前端收到 Edit/Write 权限请求时，会向后端发 `open_diff`，并等待结果（插件 2.1.282）。如果返回空，前端会**自动拒绝**这次编辑（"User cancelled the edit"）。插件后端依赖 VS Code 的 diff 标签页：找不到标签页就立刻返回空。所以 ccshell 在没有 diff 编辑器之前，每一次编辑都会被自动拒绝。

## 决定

在 `src/host/exthost/bridge.ts` 的消息层：

- 挂起 `open_diff`，不交给插件后端，也不回复；
- 用户在聊天框里的内嵌审批卡片上做出决定后，前端会发 `cancel_request`，这时再回一个空的 `open_diff_response`。这跟 VS Code 里"diff 标签页被关掉"时的行为一样；
- `accept_diff` 直接回 `found: false`，前端会改为直接接受。

另一个方案是强制打开插件的"主编辑器模式"（`IS_FULL_EDITOR`），它不走 diff。但这个模式会隐藏对话顶栏，跟插件在 VS Code 里平常的界面不一样，所以没选。

## 验证

`npm run smoke` 里的"内嵌审批接受后文件被修改"和"拒绝后文件不变"两项。
