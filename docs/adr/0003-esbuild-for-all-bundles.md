# 0003 所有包都用 esbuild 构建（不用 Vite）

- 状态：已采纳（2026-10-08）

## 背景

最初的计划是渲染进程用 Vite，其余用 esbuild。

## 决定

M0 起五个包都用 esbuild：main、preload、extension host、renderer、webview 引导脚本，统一在 `scripts/build.mjs` 里构建。

## 理由

- 只有一个构建工具、一份配置，维护成本最低。Electron 应用不需要开发服务器。
- esbuild 打包 Monaco 只需要把它的 worker 作为额外入口单独打包，M2 加上即可。
- 单元测试也用 esbuild 打包（`scripts/test.mjs`），跟正式构建的模块解析方式一致。

## M2 的补充（2026-10-09）

- renderer 改成 ESM + 代码分割（`format: 'esm'`、`splitting: true`，页面用 `<script type="module">`），Monaco、Shiki 的语法和主题、marked / DOMPurify 都放在动态 `import()` 后面，第一次用到才加载，分出来的块在 `dist/renderer/chunks/`。
- Monaco 只取编辑器核心和全部编辑功能（`monaco-editor/editor/editor.api` + `monaco-editor/features/register.all`），不要它自带的语言服务和 Monarch 分词。它的 JS 里会 import 各自的 CSS，构建时把 `.css` 当空模块，改用包里现成的整份样式（`min/vs/editor/editor.main.css`，图标字体已内嵌），复制成 `dist/renderer/monaco.css`，加载 Monaco 时插进页面。
- Monaco 的 worker（`editor.worker`，diff 计算等）单独打成一个 iife 文件 `dist/renderer/editor.worker.js`，由 `MonacoEnvironment.getWorker` 创建。
- Monaco 的界面文字（查找、右键菜单）中文包是 `monaco-editor/nls/lang/zh-cn`，必须在 Monaco 的模块求值之前加载。

## 注意

- 有些依赖的默认入口是 UMD（比如 jsonc-parser），里面的动态 `require` 打包不进来。配置里用 `mainFields: ['module', 'main']` 优先取 ESM。
- 写源码时不要在正则或字符串里直接放 U+2028/U+2029 这类不可见字符。tsc 能通过，但 esbuild 会把它们当成换行。
