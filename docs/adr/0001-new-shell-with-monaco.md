# 0001 新写壳 + Monaco，不 fork VS Code

- 状态：已采纳（2026-10-08）

## 背景

目标是一个围绕 Claude Code 插件、比 VSCodium 轻、窗口结构学 Claude app 的独立程序。候选方案有三个：

1. fork VS Code / VSCodium 源码，删掉不要的模块；
2. 不编译，给 VSCodium 换皮（改 product.json，配伴生扩展隐藏界面）；
3. 新写 Electron 壳，原样加载插件，编辑器用 Monaco。

## 决定

选 3。

## 理由

- fork 要整套编译工具链。工作台 workbench 是围绕"编辑器分组"设计的，改成 Claude app 式的布局要动最核心的代码，而且每月跟上游合并很痛苦。
- 换皮最省事，但模块只能藏不能删，体积和启动速度跟 VSCodium 一样，窗口结构基本改不了。
- 插件对 VS Code 的依赖面很小：约 96 个 API 成员，前端只通过 `acquireVsCodeApi` 通信。所以伪造一个 `vscode` 模块的成本可控。Monaco 就是 VS Code 的编辑器内核，外观一致。

## 代价

- 要自己维护兼容层。插件升级可能用到新 API，用兜底桩、日志和冒烟测试兜住。
- 编辑器之外的 VS Code 功能（标签页、评论、diff 外壳）要自己写。
