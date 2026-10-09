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

## 内容面板（M2）

窗口分三栏：会话侧边栏 | 对话 | 内容面板。内容面板（`features/contentPane`）只管标签页：打开（含 VS Code 的预览标签页）、切换、脏标记、关闭；有标签页时自动显示，最后一个关掉就隐藏。

- **编辑器贡献点** `core/editors.ts`：一个标签页 = 一个输入（`EditorInput`：类型、URI、语言、给编辑器的数据）+ 一个编辑器（`EditorPane`）。模块按输入类型 / 语言注册 `EditorProvider`，同一输入有多个提供者时取优先级高的（Markdown 预览就是这样盖过普通文本编辑器的）。
- **插件的 webview 面板**由 `core/panels.ts` 按区域分发：exthost 按面板请求的列决定区域（聊天面板永远在对话区；`ViewColumn.Beside` 或第二列以后进内容面板，插件的计划预览就是这样进来的），对话区由 conversations 模块显示，内容面板由 contentPane 模块显示。
- **compat 的标签组**跟着分成两组：第一组是对话区，第二组是内容面板（文本、diff、侧边 webview）。
- **标签页移到独立窗口**（照 VS Code 的 auxiliary window）：主窗口的页面用 `window.open('about:blank', 'ccshell-aux-…')` 开一个同源子窗口（主进程只放行这个名字前缀），子窗口里的内容由主窗口的脚本直接画：样式表、Monaco 生成的样式和主题变量从主窗口镜像过去（`features/contentPane/auxWindow.ts`）。编辑器支持 `EditorPane.relocate(容器)` 才能移：文本 / diff 编辑器在新位置重建 Monaco 控件，模型不变（未保存的修改和撤销历史都在）；webview 在新位置重新加载（计划预览会再要一次内容）。子窗口里的按键由主进程照样截住、交给主窗口的快捷键服务；命令作用在"当前"标签页上（焦点在子窗口时就是子窗口里那个，`ContentPane.current`）。关子窗口 = 关这个标签页（有未保存的修改先问），标题栏上的按钮把它移回内容面板；主窗口关闭或重新加载时子窗口一起销毁。

## 文档和编辑器

插件看到的 `TextDocument` 在 exthost（`compat/vscode/textDocuments.ts`），用户看到的编辑器在 renderer（Monaco）。规则照 VS Code：

- **attached 文档**（有编辑器在显示的）：文字以 renderer 的 Monaco 模型为准（`features/editor/textModels.ts`，同一 URI 的模型被所有编辑器共用）。用户的修改以增量 `document.didChange` 发给 exthost，exthost 更新镜像并发 `onDidChangeTextDocument`；插件要改这些文档（`applyEdit`、`TextEditor.edit`）时，exthost 请 renderer 改模型，改动再照常传回来。脏状态是模型离上次保存的版本有多远（`document.didChangeDirty`）。
- **没有编辑器的文档**由 exthost 自己读写（插件的 FileSystemProvider 也在 exthost）。
- **保存**：renderer 调 `document.save`，exthost 发 `onWillSaveTextDocument`、写盘（或写插件的 provider）、发 `onDidSaveTextDocument`。
- **磁盘被外部改了**（Claude 改文件）：exthost 监视 attached 的文件；文档干净就推 `document.reload`（renderer 用最小替换更新模型，光标和滚动位置不乱），有未保存的修改就推 `document.didChangeOnDisk`，编辑器上方出提示（重新载入 / 保留我的）。exthost 自己写盘时记下写入的内容，不会把自己的写入当成外部修改。
- **编辑器状态**：标签页和编辑器的 id 由 exthost 分配（`compat/vscode/editors.ts` 的 EditorService）。`activeTextEditor` 是内容面板显示时当前标签页的编辑器（焦点在对话里也算，跟 VS Code 在旁边一列显示文件时一样），diff 标签页的左右两个都算可见、右边是 active；选区由 renderer 推给 exthost，插件据此在聊天框里带上当前文件和选中的行。
- **diff**：`vscode.diff` 打开 Monaco 的 diff 编辑器标签页，`TabInputTextDiff` 在命令返回前就进 `tabGroups`（插件会轮询找它）。右边的文档可写时可以直接改。Claude 提议的改动（右边是插件的 `_claude_vscode_fs_right` 文档）带"接受 / 拒绝"按钮：先把这个标签页设为 active，再执行插件的接受 / 拒绝命令。

- **插件进程重启**：旧进程里的标签页和文档跟着它没了；渲染进程断开前记下打开的文件和未保存的文字，新进程连上后重新打开，再把未保存的文字作为一次编辑放回去（新进程于是看到脏文档）。diff 不恢复，它属于提出它的那次会话。

Monaco、Shiki 和 Markdown 渲染都在第一次用到时才加载（renderer 是 ESM + 代码分割，见 [ADR 0003](adr/0003-esbuild-for-all-bundles.md)）。语法高亮用 Shiki（VS Code 的 TextMate 语法，语法颜色取 Dark+ / Light+），编辑器其余颜色取抓来的主题变量。注释符号、括号、缩进规则这些语言配置取自 Monaco 自带的语言定义（只用它们的 `conf`，分词还是 Shiki）。Markdown 预览里的本地图片走 `ccw://img/<路径>`，主进程只放行工作区文件夹里的图片文件。

## 加功能该改哪里

- 插件调用了我们没实现的 VS Code API：在 `src/compat/vscode/` 对应的命名空间文件里实现。没实现的 API 会先返回一个会记日志的空桩，不会崩。
- 新的跨进程消息：先在 `protocol.ts` 加类型，再在两端 `handle` / `call`。
- 插件 webview 里某个请求要换成 ccshell 自己的做法：`bridge.ts` 加一条拦截规则，并写清楚对照的插件版本。
- 壳的界面功能（M1 起）：在 `src/features/<名字>/` 建模块，只通过 `core` 的贡献点接入（命令、快捷键、菜单、视图、编辑器类型、设置项）。以后的插件系统也会用同一套机制。
- 内容面板里新的一种标签页：注册一个 `EditorProvider`（`core/editors.ts`），再用 `IContentPane.open(输入)` 打开。要跟插件共用的文档（插件能看到、能改的）一律经 exthost 打开（`documents.show`），别在 renderer 里自己读文件。
- 快捷键注意：主进程会先截住所有注册过的组合键，页面（包括 Monaco）收不到。Monaco 自己要用的键（比如 Ctrl+F）如果被别的模块注册了，要在编辑器模块里用 `when: 'editorTextFocus'` 再注册一条转回给 Monaco。
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
