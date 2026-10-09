# 架构

## 一句话

Claude Code 插件以为自己跑在 VS Code 里。ccshell 给它伪造了一个 `vscode` 模块，把插件需要的编辑器能力翻译成 ccshell 自己的界面。

## 进程

```
Electron main ── 窗口、命令行参数、设置和状态存储（唯一写入方）、ccw:// 协议、系统集成
   │
   ├─ extension host（utilityProcess，每个窗口一个）
   │     require('vscode') 被劫持 → compat/vscode；加载 extension.js → activate(context)
   │     ↕ MessagePort，直连 renderer
   │
   └─ renderer（窗口页面）
         壳 UI：标题栏、标签页、弹层；每个插件 webview 是一个 iframe（ccw://wv<id>/）
```

- 插件跑在独立进程里：卡顿或崩溃不会拖垮窗口（跟 VS Code 的 extension host 一样）。
- 三个进程之间的所有消息都定义在 `src/platform/protocol.ts` 一个文件里，走 `src/platform/ipc.ts` 的带类型 RPC。
- webview 的消息走 renderer 的 `window.postMessage`，iframe 里先运行注入的引导脚本 `src/host/webview/bootstrap.ts`，它负责提供 `acquireVsCodeApi`、主题变量、VS Code 默认样式、链接拦截。

## 目录分层

| 目录 | 职责 | 可以依赖 |
| --- | --- | --- |
| `src/platform/` | 与环境无关的基础件：事件、Disposable、日志、RPC、协议类型、URL 规则、界面文案（nls） | 无 |
| `src/nls/` | 语言包（`zh-cn.json`：`命名空间.键` → 译文）和取包的 `packs.ts`，只给 main 和 renderer 用 | platform（只用类型） |
| `src/compat/vscode/` | VS Code API 兼容层（shim），一个命名空间一个文件 | platform |
| `src/host/node/` | main 和 extension host 共用的 Node 工具 | platform |
| `src/host/main/` | Electron 主进程 | platform、host/node、nls |
| `src/host/exthost/` | extension host 进程：加载插件、桥接 | platform、compat、host/node |
| `src/host/renderer/` | 窗口页面 | platform |
| `src/host/webview/` | 注入每个 webview 的引导脚本 | platform（只用类型） |
| `src/core/`、`src/features/` | M1 起：壳的贡献点注册表和功能模块（见下） | platform、core；core 的 workbench 还取 nls 的语言包 |

依赖只能向上指（表格上方），不能反过来。compat 不认识 Electron；platform 什么都不认识。

## 跟插件私有协议有关的代码

插件升级最容易坏的地方，全部集中在这两处，每处都注明对照的插件版本：

- `src/host/exthost/bridge.ts`：在消息层拦截插件 webview 与后端之间的私有请求（比如 `open_diff`、`open_url`）。
- `src/compat/vscode/`：插件依赖的 VS Code 行为细节（比如 diff 标签页的 `TabInputWebview` viewType 前缀）。

这两处和其他文档只描述跟插件交互时看得到的行为（消息格式、命令 id、设置项）；逆向得来的内部细节不写进仓库。

插件升级后的检查顺序：先跑 `npm run smoke`，再看最新一次 `logs\...\shim-unimplemented.log`，有新出现的 API 就补上。

## 加功能该改哪里

- 插件调用了我们没实现的 VS Code API：在 `src/compat/vscode/` 对应的命名空间文件里实现。没实现的 API 会先返回一个会记日志的空桩，不会崩。
- 新的跨进程消息：先在 `protocol.ts` 加类型，再在两端 `handle` / `call`。
- 插件 webview 里某个请求要换成 ccshell 自己的做法：`bridge.ts` 加一条拦截规则，并写清楚对照的插件版本。
- 壳的界面功能（M1 起）：在 `src/features/<名字>/` 建模块，只通过 `core` 的贡献点接入（命令、快捷键、菜单、视图、编辑器类型、设置项）。以后的插件系统也会用同一套机制。
- 界面上的文字：在模块目录的 `messages.ts` 里用 `defineMessages('<命名空间>', {...})` 写英文，代码里用 `t('键')` 取；中文进 `src/nls/zh-cn.json`，没翻译的先显示英文，`npm run nls` 检查（规范见 `docs/design.md` 的"文案"）。界面语言在每个进程启动时定好（main 算出来，传给 renderer 和 extension host），换语言要重启。

## 数据

| 路径（`%APPDATA%\ccshell\` 下） | 内容 | 谁写 |
| --- | --- | --- |
| `settings.json` | 用户设置（JSONC，键名沿用 VS Code / 插件的） | main |
| `state\global.json`、`state\workspaces\<hash>.json` | 插件的 globalState / workspaceState | main |
| `globalStorage\`、`workspaceStorage\` | 插件自己的存储目录 | 插件 |
| `logs\<启动时间>\` | 本次启动的日志，保留最近 10 次 | main / extension host |
| `chromium\` | Chromium 自己的缓存等 | Electron |

Claude 的会话记录和登录凭据在 `~\.claude\`，由 Claude CLI 管理，跟 VSCodium 里的插件共用。
