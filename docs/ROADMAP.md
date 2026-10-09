# ROADMAP

完整计划在 [PLAN.md](PLAN.md)。这里只把各阶段（M0–M6，外加插进去的 M1.5、M2.5 和可选的 M3.5）拆成勾选清单、记进度；两边对不上时以 PLAN.md 为准。

`[x]` 已完成，`[ ]` 未完成。最后一次对照代码核对：2026-10-10。

## 下一步

1. M3.5 插件界面汉化（可选）：先定方案里几处跟 PLAN 不一样的地方，再动手
2. 之后：M4

每个阶段结束都要做：typecheck、`npm test`、`node tests/ui.mjs`（动了 bridge / compat 再跑 `npm run smoke`）；看最新一次的 `shim-unimplemented.log`；确认没往 `C:\Program Files\VSCodium` 写任何东西、git 里没有密钥；用屏幕工具截图，跟 VSCodium 里的同一界面对比；用 `run-dev.cmd` 试用。

测试现状（2026-10-10）：单元 216/216，语言包 0 条缺译，界面 33/33，smoke 13/13（M3 试用后，用 Anthropic 兼容接口跑的）。

## M0 技术验证：完成（2026-10-08）

- [x] git 仓库和骨架：platform、protocol、最小 compat，以及 main、exthost、renderer
- [x] 插件从 VSCodium 目录加载（`extensionLocator.ts`），在 utilityProcess 里激活（约 20 ms），开出对话 iframe
- [x] 能收发消息
- [x] 内嵌审批的接受和拒绝都生效（`open_diff` 先挂起，见 [ADR 0002](adr/0002-hold-open-diff-until-diff-editor.md)）
- [x] `insert_at_mention` 能往输入框插纯文本；输入框能用 `[role="textbox"][aria-label="Message input"]` 定位（M3 的评论块要用）
- [x] `io_message` 的结构确认清楚（smoke 会把结构写进 exthost.log）
- [x] 登录状态跟 CLI 共用（凭据在 `~/.claude/`）
- [x] 语音输入模块 `audio-capture.node` 在 Electron 44 下能加载（没实际录音测过）

## M1 核心壳：完成（2026-10-09）

- [x] core：服务注册表、模块（`ShellModule`，带版本号的 `ShellContext`，注册都可撤销）、命令、上下文键和 when 子句、快捷键、菜单（`core/menus.ts`）、布局
- [x] 标题栏：程序名、文件夹名、对话标签页，Windows 原生窗口按钮（「文件夹 ▾」「API 接口 ▾」两个下拉放在 M4）
- [x] 会话侧边栏：插件自带的会话列表 webview，Ctrl+B 开关，宽度可拖
- [x] 多对话：标签页，Ctrl+N / Ctrl+W / Ctrl+Tab / Ctrl+1–9，Ctrl+Shift+T 重开关掉的对话
- [x] 主题：从 VSCodium 抓了 6 套内置主题（`npm run capture-themes`），壳和 webview 共用；`vilaus.theme` 和字体设置改了实时生效；命令面板里能切
- [x] 链接：webview 里的链接用外部浏览器打开
- [x] 通知：窗口没焦点时，插件的消息发系统通知并闪任务栏
- [x] 快捷键：在 main 里拦截，焦点在 webview 里也生效；命令面板 Ctrl+Shift+P / F1
- [x] 缩放：Ctrl+= / Ctrl+- / Ctrl+0，会记住
- [x] 对话内查找 Ctrl+F（在 webview 里用 CSS Custom Highlight API）
- [x] 窗口位置记忆
- [x] 重启后恢复对话（`panelRestore.ts`，借插件自己的 WebviewPanelSerializer）
- [x] 日志：`logs\<启动时间>\` 下的 main.log、exthost.log、shim-unimplemented.log、output\
- [x] 插件进程崩溃时提示，可以一键重启
- [x] 右键菜单的基础项：撤销、重做、剪切、复制、粘贴、全选；链接的"在浏览器打开 / 复制地址"
- [x] 右键菜单加插件的 `webview/context` 命令（2026-10-09）：在对话里右键有 Mark Session as Unread / Rename Session Tab / Add Session Tab to Group，会话列表里没有，跟 VS Code 一样
  - exthost 从插件清单读出菜单（`host/exthost/contributions.ts`）→ `features/extensionMenus` 登记进 core 的菜单注册表，按 when 子句和 VS Code 的排序算出每个 webview 的菜单项，登记给主进程 → 主进程右键时按 iframe 地址追加到菜单末尾，点击后回到渲染进程执行插件命令
  - 顺带补上 `showInputBox` 的 `validateInput`：重命名时空名字会被拦下，带着插件的提示再问一次
- [x] 试用 M1（2026-10-09）。试用后的改动：右键菜单项去掉 "Claude Code: " 前缀；界面要有中文 → 新增 M1.5

`claude-vscode.showLogs` 暂时只把日志路径写进 exthost.log，等 M2 的内容面板。

## M1.5 界面语言：完成（2026-10-09）

- [x] 机制：`platform/nls.ts`（`defineMessages`、`defineNames`、`{0}` 占位符、缺译回落英文），三个进程启动时定好语言；代码里只有英文，中文在语言包 `src/nls/zh-cn.json`，`npm run nls` 检查缺译和过时条目
- [x] 设置 `vilaus.language`（`auto` / `zh-cn` / `en`，默认跟随系统）；命令面板"配置显示语言"；改了以后弹提示，点"重启"后生效，打开的对话会恢复
- [x] 壳的全部现有文字两份：标题栏、标签页、空状态、查找、命令面板（含分类）、快速输入和对话框、通知、崩溃提示、右键菜单（编辑项用 Electron 的 role，但换上自己的文字）
- [x] 插件的右键菜单项：中文按命令 id 自带译名（`features/extensionMenus/commandTitles.ts`）；英文去掉 "Claude Code: " 前缀
- [x] `vscode.env.language` 和页面的 `lang` 属性跟着界面语言（中文靠 `lang` 用系统的中文字体）
- [x] 内置主题名的中文（深色 Modern、浅色+……）
- [x] 测试：nls 的单元测试；界面测试固定英文跑，最后在命令面板里切到中文、重启，检查命令面板和右键菜单
- [x] 试用（2026-10-09）。试用后的改动：代码里只写英文，中文移进单独的语言包 `src/nls/zh-cn.json`，译文可以晚点批量补；`npm run nls` 检查缺的和过时的条目

## M2 内容面板 + Monaco：完成（2026-10-09）

依赖：`monaco-editor` 0.57、`shiki` 4.5（没用 `@shikijs/monaco`：它的类型依赖没装的 `monaco-editor-core`，用到的那点逻辑自己写在 `features/editor/highlighting.ts`）、`marked` + `dompurify`。构建改动见 [ADR 0003](adr/0003-esbuild-for-all-bundles.md) 的 M2 补充；文档和编辑器的设计见 [ARCHITECTURE.md](ARCHITECTURE.md)。

- [x] 内容面板：有东西时自动打开，`Ctrl+\` 和标题栏右侧按钮开关，宽度可拖，标签页（预览标签页、脏标记、中键关闭、焦点在面板里时 Ctrl+W / Ctrl+Tab 作用于面板）
- [x] core 的 editors 贡献点（`core/editors.ts`），以及按区域分发插件 webview 面板（`core/panels.ts`）
- [x] Monaco 标签页：Shiki 高亮（语法色 Dark+ / Light+，编辑器色取主题变量，切主题跟着变），有行号；Monaco 自己的界面文字按界面语言加载它的中文包
- [x] 新加的界面文字都写中英两份（M2 的 34 条译文已补）
- [x] 打开文件：聊天里点文件（`open_file` → `showTextDocument`）、Ctrl+P / Ctrl+E 快速打开（模糊匹配）、拖进窗口（拖文件还没自动测）
- [x] Ctrl+S 保存，未保存标记，关闭时问是否保存；磁盘上被 Claude 改了：没改过就自动重新载入，改过就在编辑器上方提示
- [x] compat 的文本文档跟 Monaco 模型对上：open / change（真实增量）/ will-save / save / close 事件
- [x] Markdown：默认显示渲染后的预览（代码块用 Shiki 上色），可以切到源码（Ctrl+Shift+V）
- [x] 计划预览：插件的 `claudePlanPreview` webview 作为内容面板的标签页（smoke 验证过）
- [x] diff 标签页（ADR 0002 已被取代）
  - [x] `vscode.diff` 打开 Monaco DiffEditor 标签页，同时往 `tabGroups` 里加 `TabInputTextDiff(left, right)`，插件 `tabGroups.close` 时关掉标签页
  - [x] 右侧可编辑，改动触发 `workspace.onDidChangeTextDocument`
  - [x] "接受 / 拒绝"按钮：先把该标签设为 active，再执行 `claude-vscode.acceptProposedDiff` / `rejectProposedDiff`
  - [x] bridge 不再挂起 `open_diff`（`diffEditorAvailable: () => true`）
  - [x] 用真实会话验证（smoke）：提议改动 → diff 标签页 → 接受 / 拒绝；聊天里的内嵌审批照常能用
  - [x] 额外："Compare Active File with Saved"（跟磁盘上的版本比较），界面测试靠它覆盖 diff 标签页
- [x] 选区同步：`activeTextEditor`、`visibleTextEditors`、`showTextDocument`、`onDidChangeTextEditorSelection` 接到 Monaco，聊天框能带上当前文件
- [x] 标签页可以弹出成独立窗口（内容面板右上角的按钮或命令"Move Editor into New Window"；关窗口即关标签页，标题栏按钮移回）
- [x] 日志进面板：`claude-vscode.showLogs` 和聊天里的"打开输出"都调 `outputChannel.show()`，在内容面板打开日志文件（不需要 bridge 拦截）
- [x] smoke 改成 API 模式：`VILAUS_SMOKE_API_KEY` 或 `VILAUS_SMOKE_AUTH_TOKEN`，可选 `VILAUS_SMOKE_BASE_URL`、`VILAUS_SMOKE_MODEL`，注入测试设置里的 `claudeCode.environmentVariables`；没配就拒绝运行（`--subscription` 才用登录的账号）
- [x] smoke 加了 diff 标签页的接受 / 拒绝两项
- [x] smoke 再加：点聊天里的文件提及，Monaco 标签页打开该文件；计划模式下计划预览进内容面板
- [x] 收尾时补的：语言配置（Ctrl+/ 注释、括号、缩进，取自 Monaco 自带的语言定义）；插件进程崩溃重启后，打开的文件连同未保存的修改自动回来；Markdown 预览显示工作区里的图片（`ccw://img`，只放行工作区内的图片文件）和 https 图片；只打包 Dark+ / Light+ 两套 Shiki 主题
- [x] 试用（2026-10-09，包括弹出窗口、语言配置、Markdown 图片、拖文件进窗口）

## M2.5 设置编辑器：完成（2026-10-09）

M2 试用后加的。原来 PLAN 砍掉了设置图形界面，改为图形界面和 settings.json 编辑两者都有，跟 VS Code 一样；M4 里设置的 schema 和热更新挪到这里。

- [x] 设置的 schema 贡献点（`core/settings.ts`）：各模块注册自己的设置（键、JSON schema、所在分类）；插件的 `contributes.configuration` 也登记进来（VS Code 专用的 5 项不列出）
- [x] 渲染进程能读写设置：主进程是唯一写入方，改了推送给渲染进程；启动时没有 settings.json 就建一个空的
- [x] 设置图形界面：内容面板的标签页（Ctrl+, / 标题栏齿轮）；搜索、分类目录（窄时收起）；开关 / 下拉 / 文本和数字输入（带校验）；改过的项有标记、能还原；复杂的值链接到 settings.json（缺的键先补上默认值再定位过去）
- [x] 在 Monaco 里编辑 settings.json：Monaco 的 JSON 语言服务（单独的 worker），按已知设置生成 schema：补全、悬停说明、校验；保存后立即生效
- [x] 编辑器设置：字体、字号、字重、行高、连字、Tab 宽度 / 插入空格 / 检测缩进、自动换行（含换行列）、行号、缩略图、空白字符、括号配对着色、光标闪烁、平滑滚动、末行之后滚动；diff 并排 / 窄时内联 / 忽略首尾空白 / 换行；对普通编辑器和 diff 都实时生效。工作台一节：主题、界面字体和字号、界面语言
- [x] 测试（界面 +2 项、单元 +9 项）、中文译文（49 条）、文档
- [x] 试用（2026-10-09）。试用后加的：
  - [x] diff 自己的字体和字号（`diffEditor.fontFamily` / `diffEditor.fontSize`，为空 / 0 时跟编辑器一样）
  - [x] settings.json 比图形界面全：Monaco 的全部编辑器选项和其余 diff 选项都声明成隐藏设置（编辑器选项的说明用 Monaco 自带的，跟界面语言走），在 settings.json 里有补全、悬停说明和校验，改了实时生效；图形界面只列常用的。没声明的键忽略，跟 VS Code 一样
  - [x] 默认设置（JSON）：只读视图，列出所有设置的说明和默认值（设置界面右上角的按钮、命令"打开默认设置（JSON）"），可以弹出成独立窗口；settings.json 只存改过的项，以后默认值变了照样生效
  - [x] Ctrl+F 在有焦点的编辑器里查找，只读视图也算
  - [x] 修：设置写入失败一次后，之后的写入都跟着失败（写入队列卡死）；Windows 上目标文件被别的进程占着时替换会 EPERM，现在会短暂重试
  - [x] 测试（界面 +2 项、单元 +9 项）、中文译文（+22 条）
- [x] 试用上面这些（2026-10-09）

## M3 评论：完成（2026-10-10）

复刻插件"计划评论"的体验，做成 `features/comments`。设计见 [ARCHITECTURE.md](ARCHITECTURE.md) 的"评论（M3）"。

- [x] 添加：在 Monaco、Markdown 预览、diff（两侧都行）里选中文字 → 旁边浮出"评论"按钮 → 评论小窗（引用片段、`文件名:行号`、输入框、"添加评论 / 取消"；Enter 添加，Ctrl+Enter 也行，Shift+Enter 换行，Escape 取消；输入法选词时的 Enter 不算）
  - 按钮来自新的菜单贡献点 `editor/selection`，以后别的功能也能往选区旁加按钮；快捷键 Ctrl+Alt+M 对当前标签页的选区添加评论
  - Markdown 预览里的选区换算回源码行（渲染时每个顶层块前插行号标记）
- [x] 显示：按对话归属，在输入框正上方一条一块，新的往上叠；每块有引用片段（截断）、`文件名:行号`（点击跳回原文，Markdown 预览里也能选中原文）、评论内容、编辑（壳里的小窗盖在块上）和删除按钮；超过 3 条折叠成"N 条评论"，可展开；"清除所有评论"按钮和命令
- [x] 评论块是注入到 iframe 里的独立 DOM，用同一套主题变量，直角；锚点选择器只写在 bridge 里，经页面提示（`WebviewPageHints`）交给引导脚本；插件重新渲染后自动放回原位；块里的事件不传给插件页面；定位失败（或输入框一直没出来）就退回到壳层渲染的评论栏
- [x] 发送：bridge 拦截 `io_message`，把评论按 `[Re: "<片段>" — <文件>:<行>] <评论>` 一条一段、加说明头 `Comments on selected text:`，作为单独的 text 块附在用户文字后面；不改用户的输入；斜杠命令不带评论；发送后清空评论块
- [x] 持久化：评论跟对话面板的恢复记录一起存在 workspaceState，重启不丢（试用后改成按会话存，见下）。插件自己计划预览里的评论走插件原生流程，不重复处理
- [x] 单元测试（+57）：评论格式、CommentStore、bridge 附加评论和页面提示、视图模型、Markdown 行号换算；界面测试（+5）：编辑器和 Markdown 预览加评论、块里编辑 / 跳回 / 删除、Ctrl+Alt+M 和折叠、重启恢复、后备评论栏；smoke（+1）：两条评论 → 输入框上方两个块 → 发送后会话记录里的用户消息有两段 `[Re: …]` → 评论块清空
- [x] 试用（2026-10-10）。试用后的改动：
  - [x] 没发的评论按会话 id 存（工作区存储 `vilaus.comments`），关掉对话标签页不再丢，之后从会话列表、Ctrl+Shift+T 或重启恢复打开这个会话时回来；面板换到别的会话就显示那个会话的评论。还没发过消息的新对话没有可恢复的会话，评论先挂在面板上，会话有了记录再并进去
  - [x] 测试：单元 +12（会话归属、迁移、存取，会话 id 的解析），smoke +1（关掉对话 → Ctrl+Shift+T → 评论还在）

## M3.5 插件界面汉化（可选）：未开始

- [ ] 在本地从插件的 webview 代码里整理界面文字（按插件版本），只挑大致一行以内的界面骨架；原文清单和中间产物不提交
- [ ] 对照表：键是原文的哈希（空白规范化，带长度），值是译文，放在语言包目录下单独的文件里；翻译走壳文案的补译流程，检查对照本地的原文清单
- [ ] 引导脚本里的对照表翻译：运行时给页面文字算哈希查表，只换完全相等的文本节点和 `placeholder` / `title` / `aria-label`；MutationObserver 跟着重绘；插件文件不改
- [ ] 排除对话内容区域（回复、代码块、用户输入、diff）；长段说明文字不翻
- [ ] 设置开关（默认跟随界面语言），关掉就是原样
- [ ] 测试：smoke 固定英文；界面测试检查中文下会话列表和输入框提示是中文、对话内容不变

## M4 配置 / CLI / API 接口 / 插件管理：未开始（有零星基础）

设置

- 设置的 schema 贡献点、设置界面、在 Monaco 里编辑 settings.json：挪到了 M2.5
- [ ] 首次启动可以从 VSCodium 导入 `claudeCode.*` 和编辑器字体设置

CLI 和窗口

- [x] 已有的参数：`[folder]` / `--folder`、`--extension-dir`、`--user-data-dir`、`--theme`、`--log-level`、`--devtools`、`--secondary-display`（窗口开在非主显示器上，测试用）
- [ ] 补齐：`--provider`、`--new-window`、`--session`、`--prompt`、`--goto <file:line>`、`--settings`、`--version`、`--help`
- [ ] 单实例：第二次启动时，参数转发给已经在运行的实例
- [ ] 标题栏「文件夹 ▾」：切换或打开别的文件夹（开新窗口）；bridge 拦截插件的 `open_folder*`，改走壳的文件夹选择 / 新窗口
- [ ] 以管理员身份运行的实例用单独的 Chromium 数据目录，但共用配置，写入由 main 串行处理
- [ ] `window.registerUriHandler` 接到 vilaus:// 协议

API 接口（`features/providers`）

- [ ] 接口配置：`type`（subscription / anthropic-api / compatible / bedrock / vertex / foundry）、`baseUrl`、鉴权方式（apiKey → `ANTHROPIC_API_KEY`，bearer → `ANTHROPIC_AUTH_TOKEN`）、模型映射（主模型，Opus / Sonnet / Haiku / Fable 各档，子代理，模型选择器里显示的 `_NAME` / `_DESCRIPTION`，额外的自定义模型选项）、自定义请求头、超时、最大输出、关闭非必要流量、任意额外环境变量
- [ ] 切换接口 = 改写传给插件的 `claudeCode.environmentVariables`（加上 `disableLoginPrompt` 和 `CLAUDE_CODE_SKIP_AUTH_LOGIN`）；新开的对话生效，已经打开的对话提示重开
- [ ] 标题栏「API 接口 ▾」切换；CLI `--provider <id>`；窗口用不同的强调色区分接口
- [ ] 内置预设（数据文件）：Claude 订阅、Anthropic API、DeepSeek、Kimi、GLM、Qwen…，用户可以增删
- [ ] 密钥用 Electron `safeStorage`（Windows DPAPI）加密存放，绝不明文写进 settings.json，绝不进安装包
- [ ] 从 VSCodium 的 DeepSeek 配置档（`profiles\-68229e90`）导入成一个"DeepSeek"接口，导入后密钥立即加密
- [ ] "为此接口创建快捷方式"（比如 `Vilausity.exe --provider deepseek`）
- [ ] 单元测试：接口生成的环境变量；smoke：切到一个兼容接口，新对话的子进程环境变量正确（只检查环境，不实际调用）

插件管理（脱离 VSCodium）

- [x] 开发时用 `--extension-dir` 指定插件目录（不指定就从 VSCodium 的安装目录找）
- [ ] 查询 Open VSX → 下载 VSIX → 用 `.sha256` 校验 → 解压 `extension/` 到 `extensions\anthropic.claude-code-<ver>\` → 下次启动时切换过去；保留上一个版本用于回滚
- [ ] 设置项：自动更新开关、锁定版本；记录"最后一个能正常运行的版本"，新版本激活失败或者没实现的 API 突然变多，就提示回滚
- [ ] 下载不了时的备用办法：手动选 `.vsix` 文件导入，或者用本机 VS Code / VSCodium 里装好的插件（检查包结构和 `package.json` 的发布者、名字、平台）
- [ ] 首次启动：显示下载进度，下完走登录，或者选一个 API 接口；提示一次可选安装 Git for Windows（没有也能用，Claude 改用 PowerShell）

## M5 打包和发布：未开始

- [ ] electron-builder 打 NSIS 安装包：可以选只装当前用户，或装到 Program Files 给所有用户；建开始菜单和桌面快捷方式；卸载时默认保留 `%APPDATA%\Vilausity`
- [ ] 安装包里不含任何 Anthropic 代码（插件首次启动时从 Open VSX 下载）；不出便携版
- [ ] 目标环境：干净的 Windows 10/11 x64，只有安装包和网络；不需要 VS Code / VSCodium、单独的 Claude Code CLI、Node、Python、Git
- [ ] 发布到 GitHub Releases，新版本手动下载安装（不做自动更新）；不做代码签名，发布说明写清楚 SmartScreen 怎么放行
- [ ] 全新环境测试：临时 user-data-dir、不依赖 VSCodium、模拟没登录的情况
- [ ] 发布后交给几位使用者，在各自的电脑上从零试用：安装 → 首次启动下载插件 → 登录或配置 API → 发消息、审批改文件（没装 Git 的电脑上 Claude 用 PowerShell）；收集问题
- [ ] 装到 Program Files，分别用普通权限和管理员权限运行，再卸载

## M6 名字、图标、视觉打磨：单独讨论

- [ ] 正式名字（不能像官方产品）
- [ ] 图标
- [ ] 视觉打磨

## 贯穿各阶段（PLAN 的工程规范）

- [x] TypeScript strict，四套 tsconfig（node 侧 / 网页侧 / preload / 单元测试）
- [x] 跨进程消息的类型只在 `protocol.ts` 里定义
- [ ] 运行时校验 IPC 消息的内容（PLAN 写的是用 zod；现在 `ipc.ts` 只检查信封格式）
- [ ] ESLint + Prettier（还没装）
- [ ] 每个模块都有单元测试
  - [x] compat 的 configuration，host 的 bridge 和 webviewDocuments
  - [x] A 组：platform 的 ipc / event / cancellation，compat 的 types（2026-10-09；写测试时发现并修了 `Event.once`、ipc 发送失败、FileSystemError 名字三处源码问题）
  - [x] core 的 menus，exthost 的 contributions，compat 的 `window.showInputBox`，platform 的 webviewUrls（2026-10-09，跟右键菜单一起写的）
  - [ ] 还没有测试的：platform 的 keybindings；core 的 contextKeys / commands / module；compat 的 memento / tabs / commands / webviews；host/main 的 cli / settingsStore / stateStore
  - [x] 测试文件也做类型检查（`tsconfig.test.json`，2026-10-09；之前 esbuild 只剥类型、不检查）
- [x] ARCHITECTURE.md、design.md、ADR 0001–0003
- [x] git，Conventional Commits，每完成一步提交一次
- [x] 插件私有协议的代码只在 `bridge.ts` 和 `compat/vscode/`，每处注明插件版本（当前 2.1.282）

## 还没排进阶段的（PLAN 里有，但没写归哪个阶段）

- [ ] bridge 拦截 `open_terminal` / `open_claude_in_terminal`，改用 Windows Terminal 打开（现在原样转给插件后端，没做专门处理）
