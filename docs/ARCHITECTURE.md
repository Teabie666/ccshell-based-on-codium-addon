# 架构

## 一句话

Claude Code 插件以为自己跑在 VS Code 里。Vilausity 给它伪造了一个 `vscode` 模块，把插件需要的编辑器能力翻译成 Vilausity 自己的界面。

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
- **标签页移到独立窗口**（照 VS Code 的 auxiliary window）：主窗口的页面用 `window.open('about:blank', 'vilaus-aux-…')` 开一个同源子窗口（主进程只放行这个名字前缀），子窗口里的内容由主窗口的脚本直接画：样式表、Monaco 生成的样式和主题变量从主窗口镜像过去（`features/contentPane/auxWindow.ts`）。编辑器支持 `EditorPane.relocate(容器)` 才能移：文本 / diff 编辑器在新位置重建 Monaco 控件，模型不变（未保存的修改和撤销历史都在）；webview 在新位置重新加载（计划预览会再要一次内容）。子窗口里的按键由主进程照样截住、交给主窗口的快捷键服务；命令作用在"当前"标签页上（焦点在子窗口时就是子窗口里那个，`ContentPane.current`）。关子窗口 = 关这个标签页（有未保存的修改先问），标题栏上的按钮把它移回内容面板；主窗口关闭或重新加载时子窗口一起销毁。

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

## 设置（M2.5）

- **settings.json 只有主进程写**（`host/main/settingsStore.ts`，用 jsonc-parser 改，保留用户的注释和格式；文件被手改也会重新读）。改动推给 exthost（`settings.didChange`，插件的 `getConfiguration` 用）和渲染进程（`settingsChanged`）。渲染进程启动时读一次（`settings.read`），写用 `settings.update`（`undefined` 表示删掉、回到默认值）。
- **设置的贡献点** `core/settings.ts`：模块用 `ISettings.register` 声明自己的设置：键、值的 JSON schema（类型、默认值、说明、枚举、上下限……）、设置界面里的分区。插件的 `contributes.configuration` 从它的清单读出来一并声明；给 VS Code 界面用、在 Vilausity 里没意义的几项标成 `hidden`（不在设置界面列出，但留在 schema 里）。读值用 `get(键, 兜底)`：用户的值，否则声明的默认值。
- **设置编辑器**（`features/settings`）是内容面板的一个标签页，照 VS Code 的设置界面：按类型给控件，和默认值相同的值不写进文件（保持 settings.json 简短）。**settings.json** 用普通文本标签页打开，Monaco 的 JSON 语言服务（单独的 `json.worker`）按所有声明生成的 schema 给补全、悬停说明和校验。注意：JSON 语言服务的 `fileMatch` 是 glob（前面自动加 `**/`），拿去匹配的是解码后的 URI，所以给的是"上级文件夹/settings.json"，不是完整 URI。
- **编辑器设置**用 VS Code 的键名和默认值（`editor.*`、`diffEditor.*`）。字体相关的（`editor.fontFamily` 等）由主进程算成主题的字体变量，webview 和编辑器共用；其余的由编辑器模块转成 Monaco 选项，改了实时作用到所有文本和 diff 编辑器。加一项设置：在模块里 `register` 声明，`get` 读，`onDidChange` 里重新应用。
- **settings.json 比设置界面全**：设置界面只列常用的；Monaco 的编辑器选项自带 JSON schema（VS Code 的 `editor.*` 设置就是从它生成的，说明文字随 Monaco 的语言包），编辑器模块加载 Monaco 后把还没声明的都登记成 `hidden` 设置（`monacoOptionDefinitions`）；diff 编辑器的其余选项 Monaco 没有 schema，照 VS Code 的键名手写声明。settings.json 里的 `editor.*` / `diffEditor.*` 只要声明过，就转成 Monaco 的嵌套选项（`editor.minimap.side` → `minimap.side`，`diffEditor.wordWrap` → `diffWordWrap`）；没声明的忽略（跟 VS Code 一样），所以碰不到 `readOnly`、`automaticLayout` 这类不该开放的选项。字体走主题变量、缩进走模型（`applyIndentation`），不经这条路。
- **默认设置（JSON）**：只读的 Monaco 编辑器（`TextEditorService.createViewer`，背后没有文档，插件看不到），内容由所有声明生成（`defaultSettingsText`），声明变了（比如插件的设置晚到）跟着刷新。查找命令找当前有焦点的编辑器（`focusedCodeEditor`），所以 Ctrl+F 在它里面也能用。
- **写 settings.json**：先写临时文件再 rename（`host/node/jsonFile.ts`）。Windows 上目标文件被别的进程打开着（读它的程序、杀毒软件、同步盘）时 rename 会 EPERM，所以短暂重试，跟 graceful-fs 一样。写入排队执行，一次失败不影响后面的。

## 评论（M3）

在内容面板里选中文字写评论，评论显示在对话输入框正上方，随下一条消息发给 Claude（照插件计划评论的做法）。

- **选中按钮**是一个通用的菜单贡献点 `editor/selection`（`MenuId.EditorSelection`）：编辑器里有选区时，这个菜单的按钮浮在选区旁边；命令收到 `EditorSelectionContext`（选中的文字、文档 URI、文件路径、范围，以及 `showWidget`，用来在按钮的位置显示自己的界面）。文本和 diff 编辑器用 Monaco 的 content widget（`features/editor/selectionMenu.ts`）；Markdown 预览自己摆放（渲染时在每个顶层块前插一个隐藏的源码行号标记，选区按最近的标记换算回源码行，`features/markdown/sourceLines.ts`）。评论模块（`features/comments`）往这个菜单里登记"评论"，以后别的功能也可以加按钮。快捷键 Ctrl+Alt+M 作用于当前标签页的选区（`EditorPane.selectionContext`）。
- **数据在插件进程**：`host/exthost/comments.ts` 的 CommentStore 按对话（聊天面板的 webview）存评论。渲染进程用 `comments.add / update / remove` 修改，收 `comments.didChange` 显示。bridge 在用户发消息（`io_message`）时同步取出评论，作为一个单独的 text 块附在用户打的字后面（斜杠命令不带），然后清空。评论跟对话面板的恢复记录一起存（PanelRestore），重启后回来；关掉对话就丢弃它没发出的评论。
- **评论块在插件页面里**：块该放在哪个元素前面是插件页面的知识，只写在 bridge 里，以 `WebviewPageHints.commentsAnchor`（输入框所在 form 的选择器）随页面文档交给引导脚本（`host/webview/comments.ts`）。引导脚本把块插在锚点前，用 MutationObserver 在插件重新渲染后放回原位；块里的事件不会冒泡到插件页面；所有文字由壳算好（包括翻译）再发进去，引导脚本里没有界面文案。编辑在壳里进行（小窗盖在块的位置上）。插件页面会量输入区的高度给消息列表垫底，所以块不会挡住最后一条消息。
- **后备**：页面一直找不到锚点（插件改了界面，或者输入框还没出来）时，壳在对话下方显示内容相同的评论栏（`features/comments/fallbackBar.ts`），功能不受影响。
- **发出去的格式**：以 `Comments on selected text:` 开头，每条评论一段：`[Re: "<片段>" — <文件>:<行>] <评论>`。片段压成一行、过长截断；文件是相对工作区的路径；行是 `12` 或 `12-15`。
- 点评论块上的 `文件名:行号` 回到原文：打开着的标签页（文本、diff、Markdown 预览）用 `EditorPane.revealSelection` 选中那段文字，没打开就经插件进程打开文件再选中。

## 加功能该改哪里

- 插件调用了我们没实现的 VS Code API：在 `src/compat/vscode/` 对应的命名空间文件里实现。没实现的 API 会先返回一个会记日志的空桩，不会崩。
- 新的跨进程消息：先在 `protocol.ts` 加类型，再在两端 `handle` / `call`。
- 插件 webview 里某个请求要换成 Vilausity 自己的做法：`bridge.ts` 加一条拦截规则，并写清楚对照的插件版本。
- 壳的界面功能（M1 起）：在 `src/features/<名字>/` 建模块，只通过 `core` 的贡献点接入（命令、快捷键、菜单、视图、编辑器类型、设置项）。以后的插件系统也会用同一套机制。
- 内容面板里新的一种标签页：注册一个 `EditorProvider`（`core/editors.ts`），再用 `IContentPane.open(输入)` 打开。要跟插件共用的文档（插件能看到、能改的）一律经 exthost 打开（`documents.show`），别在 renderer 里自己读文件。
- 选中文字旁边的按钮：往 `editor/selection` 菜单（`MenuId.EditorSelection`）登记一个命令，命令收到 `EditorSelectionContext`，可以用 `showWidget` 在原地显示自己的界面（评论的小窗就是这样）。
- 快捷键注意：主进程会先截住所有注册过的组合键，页面（包括 Monaco）收不到。Monaco 自己要用的键（比如 Ctrl+F）如果被别的模块注册了，要在编辑器模块里用 `when: 'editorTextFocus'` 再注册一条转回给 Monaco。
- 界面上的文字：在模块目录的 `messages.ts` 里用 `defineMessages('<命名空间>', {...})` 写英文，代码里用 `t('键')` 取；中文进 `src/nls/zh-cn.json`，没翻译的先显示英文，`npm run nls` 检查（规范见 `docs/design.md` 的"文案"）。界面语言在每个进程启动时定好（main 算出来，传给 renderer 和 extension host），换语言要重启。

## 数据

| 路径（`%APPDATA%\Vilausity\` 下） | 内容 | 谁写 |
| --- | --- | --- |
| `settings.json` | 用户设置（JSONC，键名沿用 VS Code / 插件的） | main |
| `state\global.json`、`state\workspaces\<hash>.json` | 插件的 globalState / workspaceState | main |
| `globalStorage\`、`workspaceStorage\` | 插件自己的存储目录 | 插件 |
| `logs\<启动时间>\` | 本次启动的日志，保留最近 10 次 | main / extension host |
| `chromium\` | Chromium 自己的缓存等 | Electron |

Claude 的会话记录和登录凭据在 `~\.claude\`，由 Claude CLI 管理，跟 VSCodium 里的插件共用。
