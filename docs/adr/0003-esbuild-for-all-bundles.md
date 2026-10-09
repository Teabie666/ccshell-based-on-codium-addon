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

## 注意

- 有些依赖的默认入口是 UMD（比如 jsonc-parser），里面的动态 `require` 打包不进来。配置里用 `mainFields: ['module', 'main']` 优先取 ESM。
- 写源码时不要在正则或字符串里直接放 U+2028/U+2029 这类不可见字符。tsc 能通过，但 esbuild 会把它们当成换行。
