/**
 * The single source of truth for every message that crosses a process boundary.
 *
 *   main  <--(utilityProcess port)-->  extension host  <--(MessagePort)-->  renderer
 *     ^                                                                        |
 *     +-------------------------(ipc via preload)------------------------------+
 *
 * Each `XxxApiForYyy` type lists the methods process Xxx serves to process Yyy.
 * The renderer also talks to webview iframes through window.postMessage; those
 * envelopes are defined at the bottom.
 *
 * Rule: only plain, structured-clone-safe data here (no class instances, no functions).
 */

import type { UiLanguage, UiLanguageSetting } from './nls';

// ---------------------------------------------------------------------------
// Shared data types
// ---------------------------------------------------------------------------

export type StorageScope = 'global' | 'workspace';

export type ThemeKind =
  | 'vscode-dark'
  | 'vscode-light'
  | 'vscode-high-contrast'
  | 'vscode-high-contrast-light';

export interface ThemeData {
  /** Stable id, e.g. `dark-modern`. */
  readonly id: string;
  /** Human label, e.g. `Dark Modern`. */
  readonly label: string;
  readonly kind: ThemeKind;
  /** CSS custom properties without the leading `--`, e.g. `vscode-editor-background`. */
  readonly variables: Readonly<Record<string, string>>;
}

/**
 * Translations of the Claude Code extension's own UI text (M3.5, see
 * platform/extensionStrings.ts). Holds no English: keys are lengths and hashes.
 */
export interface ExtensionTranslations {
  /** The extension version the table was last checked against. */
  readonly extensionVersion: string;
  /** `<length>:<hash>` of a normalized text -> its translation ("" keeps the English). */
  readonly strings: Readonly<Record<string, string>>;
  /** `<prefix length>:<suffix length>:<hash>` of a template with one variable -> its translation. */
  readonly templates: Readonly<Record<string, TemplateTranslation>>;
}

export interface TemplateTranslation {
  /** What the variable may be: digits (a count, a percentage) or any short text. */
  readonly type: 'number' | 'any';
  /** `{0}` stands for the variable ("" keeps the English). */
  readonly text: string;
}

export interface AppInfo {
  /** Reported as `vscode.env.appName`; the extension tunes behaviour per host, so we mimic VSCodium. */
  readonly appName: string;
  /** Reported as `vscode.version`. */
  readonly vscodeVersion: string;
  readonly uriScheme: string;
  /** Reported as `vscode.env.language`: the shell's display language, as VS Code does. */
  readonly language: UiLanguage;
  readonly machineId: string;
  readonly sessionId: string;
  readonly shell: string;
}

export interface ExtHostPaths {
  readonly userData: string;
  readonly logs: string;
  readonly globalStorage: string;
  readonly workspaceStorage: string;
}

export interface ExtHostInitData {
  /** Directory that contains the Claude Code extension's package.json. */
  readonly extensionPath: string;
  readonly workspaceFolders: readonly string[];
  readonly paths: ExtHostPaths;
  /** Flat `section.key -> value` map from the user's settings file. */
  readonly settings: Readonly<Record<string, unknown>>;
  readonly globalState: Readonly<Record<string, unknown>>;
  readonly workspaceState: Readonly<Record<string, unknown>>;
  readonly logLevel: number;
  readonly app: AppInfo;
  readonly themeKind: ThemeKind;
  /** The extension UI's translations in this run's language (none for English). */
  readonly extensionTranslations?: ExtensionTranslations;
}

/**
 * What the shell's script in a webview needs to know about the extension's page. Only the
 * bridge (host/exthost/bridge.ts) knows the extension's pages, so it supplies these; most
 * webviews have none.
 */
export interface WebviewPageHints {
  /**
   * CSS selector of the element comment blocks go right before (a conversation's message
   * input). Set for conversation panels only.
   */
  readonly commentsAnchor?: string;
  /**
   * CSS selector of the parts of the page that show content rather than the extension's own
   * UI (the conversation, names, what Claude asks), which the translation of the extension's
   * UI text leaves alone. Pages without it are not translated.
   */
  readonly untranslated?: string;
}

export interface WebviewDocument {
  readonly webviewId: string;
  /** The HTML exactly as the extension assigned it to `webview.html`. */
  readonly html: string;
  /** Absolute directories the webview may load resources from. */
  readonly resourceRoots: readonly string[];
  /** Last value passed to `setState`, restored into `getState()` on reload. */
  readonly state?: unknown;
  readonly hints?: WebviewPageHints;
}

export interface IconPathDto {
  readonly light: string;
  readonly dark: string;
}

/**
 * Where a webview panel is shown: `main` is the conversation area (VS Code's first editor
 * column), `side` the content pane (any column beside it).
 */
export type PanelArea = 'main' | 'side';

export interface PanelCreateParams {
  readonly panelId: string;
  readonly webviewId: string;
  readonly viewType: string;
  readonly title: string;
  readonly area: PanelArea;
  readonly iconPath?: IconPathDto;
  readonly preserveFocus: boolean;
  readonly retainContextWhenHidden: boolean;
  readonly enableFindWidget: boolean;
}

export interface PanelUpdateParams {
  readonly panelId: string;
  readonly title?: string;
  readonly iconPath?: IconPathDto | null;
}

/** A webview view (`registerWebviewViewProvider`), e.g. the extension's session list. */
export interface ViewCreateParams {
  readonly viewId: string;
  readonly webviewId: string;
  readonly viewType: string;
  readonly title?: string;
}

export interface ViewUpdateParams {
  readonly viewId: string;
  readonly title?: string;
  readonly description?: string;
  /** Badge count; 0 clears it. */
  readonly badge?: number;
}

export type MessageSeverity = 'info' | 'warning' | 'error';

export interface MessageRequest {
  readonly severity: MessageSeverity;
  readonly message: string;
  readonly detail?: string;
  readonly modal: boolean;
  readonly items: readonly string[];
}

export interface QuickPickItemDto {
  readonly label: string;
  readonly description?: string;
  readonly detail?: string;
  readonly picked?: boolean;
  readonly separator?: boolean;
}

export interface QuickPickRequest {
  readonly items: readonly QuickPickItemDto[];
  readonly title?: string;
  readonly placeHolder?: string;
  readonly canPickMany: boolean;
}

export interface InputBoxRequest {
  readonly title?: string;
  readonly prompt?: string;
  readonly placeHolder?: string;
  readonly value?: string;
  readonly password: boolean;
  /** Shown as an error under the input: `value` failed the extension's `validateInput`. */
  readonly validationMessage?: string;
}

/** A `contributes.commands` entry of the extension's package.json. */
export interface CommandContribution {
  readonly command: string;
  readonly title: string;
  readonly category?: string;
}

/** A `contributes.menus[menuId]` entry of the extension's package.json. */
export interface MenuItemContribution {
  readonly command: string;
  readonly when?: string;
  /** VS Code syntax: `group` or `group@order`. */
  readonly group?: string;
}

/** A setting with the JSON schema of its value, as a `contributes.configuration` property declares it. */
export interface SettingContribution {
  readonly key: string;
  /** type, default, description / markdownDescription, enum, minimum... as declared. */
  readonly schema: Readonly<Record<string, unknown>>;
  /** The configuration's title, e.g. `Claude Code`. */
  readonly section: string;
}

/** What the extension declares in its package.json that the shell shows itself. */
export interface ExtensionContributions {
  readonly commands: readonly CommandContribution[];
  /** By menu id, e.g. `webview/context`. */
  readonly menus: Readonly<Record<string, readonly MenuItemContribution[]>>;
  readonly configuration: readonly SettingContribution[];
}

/** One entry the renderer adds to a webview's right-click menu. */
export interface ContextMenuItemDto {
  /** Sent back in the `contextMenuAction` event when the item is clicked. */
  readonly id: string;
  readonly label: string;
}

// ---- documents and editors (the content pane) ----
//
// Documents shown in an editor ("attached") are owned by the renderer's text model: the
// extension host mirrors them from `document.didChange`, and asks the renderer to apply
// its own edits. See docs/ARCHITECTURE.md ("文档和编辑器").

/**
 * A file's text on disk, read-only, whatever its editor holds (the file URI with this
 * scheme): the left side of "Compare Active File with Saved".
 */
export const SAVED_FILE_SCHEME = 'vilaus-saved';

/** 0-based, like `vscode.Position`. */
export interface PositionDto {
  readonly line: number;
  readonly character: number;
}

export interface RangeDto {
  readonly start: PositionDto;
  readonly end: PositionDto;
}

export interface SelectionDto {
  readonly anchor: PositionDto;
  readonly active: PositionDto;
}

export interface DocumentSnapshot {
  /** `vscode.Uri.toString()`: the document's identity on both sides. */
  readonly uri: string;
  /** `fsPath` for file URIs, else the URI path; for labels and tooltips. */
  readonly path: string;
  readonly text: string;
  readonly languageId: string;
  readonly isDirty: boolean;
  readonly readOnly: boolean;
}

/** One change of a `document.didChange`, against the text before that event. */
export interface TextChangeDto {
  readonly range: RangeDto;
  readonly rangeOffset: number;
  readonly rangeLength: number;
  readonly text: string;
}

export interface TextEditDto {
  readonly range: RangeDto;
  readonly text: string;
}

/** `vscode.TextEditorRevealType`, by name. */
export type RevealType = 'default' | 'center' | 'centerIfOutside' | 'top';

export interface ShowTextEditorParams {
  /** The tab and editor ids the extension host assigned (`TabImpl`, `TextEditor`). */
  readonly tabId: string;
  readonly editorId: string;
  readonly document: DocumentSnapshot;
  readonly preserveFocus: boolean;
  /** A preview tab is replaced by the next preview, until it is edited or pinned. */
  readonly preview: boolean;
  readonly selection?: RangeDto;
}

/** A button above a diff that runs an extension command (with the diff tab made active first). */
export interface DiffActionDto {
  readonly command: string;
  readonly kind: 'accept' | 'reject';
}

export interface ShowDiffEditorParams {
  readonly tabId: string;
  readonly title: string;
  readonly original: DocumentSnapshot;
  readonly modified: DocumentSnapshot;
  readonly originalEditorId: string;
  readonly modifiedEditorId: string;
  readonly preserveFocus: boolean;
  readonly actions: readonly DiffActionDto[];
}

// ---- comments ----
//
// Comments on text selected in the content pane belong to a conversation (by its webview)
// until the next message, which carries them. The extension host keeps them (the bridge
// needs them when a message goes out); the renderer adds, edits and shows them.

export interface CommentDto {
  readonly id: string;
  /** The text the comment is about, as selected. */
  readonly quote: string;
  /** The document it was selected in (`vscode.Uri.toString()`), and the file's path. */
  readonly uri: string;
  readonly path: string;
  /** Where in that document; for a rendered view (Markdown preview), the lines it came from. */
  readonly range: RangeDto;
  readonly text: string;
}

export interface RendererInitData {
  readonly theme: ThemeData;
  readonly workspaceFolders: readonly string[];
  readonly appVersion: string;
  /** The display language for this run; a change takes a restart. */
  readonly language: UiLanguage;
}

// ---------------------------------------------------------------------------
// main <-> extension host
// ---------------------------------------------------------------------------

/** Served by main, called by the extension host. */
export type MainApiForExtHost = {
  'exthost.activated': (p: { extensionVersion: string }) => void;
  'exthost.activationFailed': (p: { message: string; stack?: string }) => void;
  'webview.setDocument': (p: WebviewDocument) => void;
  'webview.releaseDocument': (p: { webviewId: string }) => void;
  'os.openExternal': (p: { url: string }) => boolean;
  'os.clipboardRead': (p: void) => string;
  'os.clipboardWrite': (p: { text: string }) => void;
  /** `value: undefined` deletes the key. */
  'storage.set': (p: { scope: StorageScope; key: string; value: unknown }) => void;
  /** `value: undefined` removes the setting. */
  'settings.set': (p: { key: string; value: unknown }) => void;
};

/** Served by the extension host, called by main. The `init` call carries the renderer port. */
export type ExtHostApiForMain = {
  init: (p: ExtHostInitData) => void;
  'settings.didChange': (p: { settings: Readonly<Record<string, unknown>>; keys: readonly string[] }) => void;
  /**
   * Another window's extension host changed a stored value. Global state is shared by all
   * windows (VS Code syncs `globalState` across windows too); `value: undefined` deleted it.
   */
  'storage.didChange': (p: { scope: StorageScope; key: string; value: unknown }) => void;
  shutdown: (p: void) => void;
};

// ---------------------------------------------------------------------------
// renderer <-> extension host
// ---------------------------------------------------------------------------

/** Served by the extension host, called by the renderer. */
export type ExtHostApiForRenderer = {
  /** The renderer has wired the port and can receive panels. */
  'renderer.ready': (p: void) => void;
  'webview.didLoad': (p: { webviewId: string }) => void;
  'webview.didReceiveMessage': (p: { webviewId: string; message: unknown }) => void;
  'webview.didUpdateState': (p: { webviewId: string; state: unknown }) => void;
  'panel.didChangeViewState': (p: { panelId: string; active: boolean; visible: boolean }) => void;
  /** The user closed a panel's tab in the shell. */
  'panel.didClose': (p: { panelId: string }) => void;
  /**
   * The shell wants to show the view registered under `viewType`. Resolves to false when
   * the extension registered no provider for it.
   */
  'view.resolve': (p: { viewType: string }) => boolean;
  'view.didChangeVisibility': (p: { viewId: string; visible: boolean }) => void;
  'commands.execute': (p: { id: string; args: readonly unknown[] }) => unknown;
  /** Read from the manifest, so it does not wait for activation. */
  'extension.contributions': (p: void) => ExtensionContributions;

  // ---- documents and editors ----
  /** The shell opens a file (quick open, drop...); answered by `editor.showText`. False if it cannot be read. */
  'documents.show': (p: { uri: string; preserveFocus: boolean; preview: boolean; selection?: RangeDto }) => boolean;
  /** Workspace files for quick open, relative to the first folder with `/` separators. */
  'documents.listFiles': (p: { maxResults: number }) => string[];
  'document.didChange': (p: {
    uri: string;
    changes: readonly TextChangeDto[];
    isUndoing: boolean;
    isRedoing: boolean;
  }) => void;
  'document.didChangeDirty': (p: { uri: string; isDirty: boolean }) => void;
  /** Saves the attached document (fires will-save and did-save). False when it cannot be saved. */
  'document.save': (p: { uri: string }) => boolean;
  /** Discards unsaved changes: answered by `document.reload` with the text on disk. */
  'document.revert': (p: { uri: string }) => void;
  'editor.didChangeSelection': (p: { editorId: string; selections: readonly SelectionDto[] }) => void;
  /**
   * Which editors the user sees: `visible` are the editors of the active content tab while
   * the content pane is shown, `active` the one among them that takes input.
   */
  'editor.didChangeVisible': (p: { active: string | undefined; visible: readonly string[] }) => void;
  /** A content tab became the active one (also makes its tab group the active group). */
  'tab.didActivate': (p: { tabId: string }) => void;
  /** The user closed a text or diff tab. */
  'tab.didClose': (p: { tabId: string }) => void;

  // ---- comments (answered by `comments.didChange`) ----
  'comments.add': (p: { webviewId: string; comment: CommentDto }) => void;
  'comments.update': (p: { webviewId: string; id: string; text: string }) => void;
  'comments.remove': (p: { webviewId: string; ids: readonly string[] }) => void;
};

/** Served by the renderer, called by the extension host. */
export type RendererApiForExtHost = {
  'panel.create': (p: PanelCreateParams) => void;
  'panel.update': (p: PanelUpdateParams) => void;
  'panel.reveal': (p: { panelId: string; preserveFocus: boolean }) => void;
  'panel.dispose': (p: { panelId: string }) => void;
  'view.create': (p: ViewCreateParams) => void;
  'view.update': (p: ViewUpdateParams) => void;
  'view.reveal': (p: { viewId: string; preserveFocus: boolean }) => void;
  'view.dispose': (p: { viewId: string }) => void;
  'webview.load': (p: { webviewId: string; url: string }) => void;
  'webview.postMessage': (p: { webviewId: string; message: unknown }) => void;
  /** Resolves to the index of the chosen item, or undefined if dismissed. */
  'ui.showMessage': (p: MessageRequest) => number | undefined;
  /** Resolves to the indexes of the chosen items, or undefined if dismissed. */
  'ui.showQuickPick': (p: QuickPickRequest) => number[] | undefined;
  'ui.showInputBox': (p: InputBoxRequest) => string | undefined;

  // ---- documents and editors ----
  /** Opens (or activates) a text tab in the content pane. */
  'editor.showText': (p: ShowTextEditorParams) => void;
  'editor.showDiff': (p: ShowDiffEditorParams) => void;
  'editor.setSelections': (p: { editorId: string; selections: readonly SelectionDto[] }) => void;
  'editor.revealRange': (p: { editorId: string; range: RangeDto; revealType: RevealType }) => void;
  /** The extension closed a content tab (`tabGroups.close`). */
  'tab.close': (p: { tabId: string }) => void;
  /** Applies edits to an attached document; they come back as `document.didChange`. */
  'document.applyEdits': (p: { uri: string; edits: readonly TextEditDto[] }) => boolean;
  /** Replaces an attached document's text with what is on disk and marks it saved. */
  'document.reload': (p: { uri: string; text: string }) => void;
  /** An attached document was saved (also when the extension saved it). */
  'document.didSave': (p: { uri: string }) => void;
  /** An attached document with unsaved changes changed on disk. */
  'document.didChangeOnDisk': (p: { uri: string }) => void;

  /** A conversation's comments, oldest first: added, edited, removed, sent or restored. */
  'comments.didChange': (p: { webviewId: string; comments: readonly CommentDto[] }) => void;
};

// ---------------------------------------------------------------------------
// renderer <-> main (through the preload bridge)
// ---------------------------------------------------------------------------

export interface ThemeSummary {
  readonly id: string;
  readonly label: string;
  readonly kind: ThemeKind;
}

/** Served by main, called by the renderer. */
export type MainApiForRenderer = {
  'app.getInitData': (p: void) => RendererInitData;
  'app.listThemes': (p: void) => ThemeSummary[];
  /** Switches the theme, persists it in settings, and returns the full theme data. */
  'app.setTheme': (p: { id: string }) => ThemeData;
  /** Restarts the extension host after a crash. */
  'app.restartExtensionHost': (p: void) => void;
  /** The `vilaus.language` setting and the language this run shows. */
  'app.getLanguage': (p: void) => { setting: UiLanguageSetting; running: UiLanguage };
  /** Saves `vilaus.language`; main answers with `languageChanged` if a restart is needed. */
  'app.setLanguage': (p: { setting: UiLanguageSetting }) => void;
  /** Quits and starts again with the same arguments (open conversations are restored). */
  'app.relaunch': (p: void) => void;
  'os.openExternal': (p: { url: string }) => boolean;
  /** A system notification; also flashes the taskbar button. Only shown while unfocused. */
  'os.notify': (p: { title: string; body: string }) => void;
  /** The user's settings (flat `section.key -> value`) and where settings.json is. */
  'settings.read': (p: void) => { values: Record<string, unknown>; filePath: string };
  /** Writes one setting to settings.json; `value: undefined` removes it (back to the default). */
  'settings.update': (p: { key: string; value: unknown }) => void;
  'window.toggleDevTools': (p: void) => void;
  /** The chords main should intercept and send back as `keybinding` events. */
  'window.setKeybindings': (p: { chords: readonly string[] }) => void;
  /** `delta` in zoom steps, or 0 to reset. Returns the new zoom level. */
  'window.zoom': (p: { delta: number }) => number;
  /**
   * The items main appends to the right-click menu inside one webview, in groups (a
   * separator between groups). No groups removes them.
   */
  'window.setWebviewMenu': (p: { webviewId: string; groups: readonly (readonly ContextMenuItemDto[])[] }) => void;
};

/** Events main pushes to the renderer (through the preload, as window messages). */
export type MainEventsForRenderer = {
  keybinding: { readonly chord: string };
  extensionHostState: { readonly state: 'running' | 'crashed'; readonly detail?: string };
  /** The theme changed (picked in the shell, or theme/font settings edited by hand). */
  themeChanged: ThemeData;
  /** The user clicked an item registered with `window.setWebviewMenu`. */
  contextMenuAction: { readonly webviewId: string; readonly id: string };
  /** Settings now ask for another display language than this run shows; it applies on restart. */
  languageChanged: { readonly language: UiLanguage };
  /** settings.json changed (from the shell or by hand): all values, and the keys that changed. */
  settingsChanged: { readonly values: Readonly<Record<string, unknown>>; readonly keys: readonly string[] };
  /** The extension's UI text is translated with this table now (null: it is not). */
  extensionTranslationsChanged: { readonly translations: ExtensionTranslations | null };
};

export interface MainEventMessage<K extends keyof MainEventsForRenderer = keyof MainEventsForRenderer> {
  readonly type: typeof IpcChannel.Event;
  readonly name: K;
  readonly payload: MainEventsForRenderer[K];
}

/**
 * `window.open('about:blank', name)` with a name starting with this opens an auxiliary
 * window: a content pane tab moved out of the main window (main allows only these).
 */
export const AUX_WINDOW_NAME_PREFIX = 'vilaus-aux-';

/** IPC channel names used by the preload bridge. */
export const IpcChannel = {
  /** renderer -> main request/response, carries an RPC envelope. */
  Rpc: 'vilaus:rpc',
  /** main -> renderer, transfers the extension host MessagePort. */
  ExtHostPort: 'vilaus:exthost-port',
  /** main -> renderer events (MainEventsForRenderer). */
  Event: 'vilaus:event',
} as const;

// ---------------------------------------------------------------------------
// renderer <-> webview iframes (window.postMessage)
// ---------------------------------------------------------------------------

/** Data the shell injects into each webview document before the extension's scripts run. */
export interface WebviewBootstrapData {
  readonly webviewId: string;
  readonly state: unknown;
  readonly theme: ThemeData;
  readonly hints?: WebviewPageHints;
  /** Shows the extension's UI text in the display language (pages with `hints.untranslated` only). */
  readonly translations?: ExtensionTranslations;
}

/** An element's box in a webview's viewport, in CSS pixels. */
export interface RectDto {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** One comment block as a webview shows it; the shell has already made every text final. */
export interface CommentBlockDto {
  readonly id: string;
  /** The quoted text, already shortened. */
  readonly quote: string;
  /** `sample.ts:12`, with the whole path as its tooltip. */
  readonly source: string;
  readonly sourceTitle: string;
  readonly text: string;
}

/** The comments above a conversation's input, ready to render. */
export interface CommentsViewDto {
  /** Newest first: new blocks stack on top, the oldest sits right above the input. */
  readonly blocks: readonly CommentBlockDto[];
  /** Whether they start folded into the header (there are many) until the user unfolds them. */
  readonly collapsed: boolean;
  readonly labels: {
    /** E.g. `3 comments`. */
    readonly header: string;
    /** What happens to them, e.g. `Sent with your next message`. */
    readonly hint: string;
    readonly edit: string;
    readonly remove: string;
    readonly clear: string;
    readonly expand: string;
    readonly collapse: string;
  };
}

/** What the comment blocks in a webview report to the shell. */
export type CommentsHostEvent =
  /** The blocks found their place above the input (or lost it); the shell shows them itself meanwhile. */
  | { readonly type: 'attached'; readonly attached: boolean }
  /** `rect`: the block, where the shell opens its editor. */
  | { readonly type: 'edit'; readonly id: string; readonly rect: RectDto }
  | { readonly type: 'remove'; readonly id: string }
  /** The source link was clicked: show the commented text. */
  | { readonly type: 'reveal'; readonly id: string }
  | { readonly type: 'clear' };

export interface KeyEventDto {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly repeat: boolean;
}

/** Posted by the bootstrap script in a webview to the shell. `ccw` holds the webview id. */
export type WebviewToShellMessage =
  | { readonly ccw: string; readonly kind: 'message'; readonly message: unknown }
  | { readonly ccw: string; readonly kind: 'state'; readonly state: unknown }
  | { readonly ccw: string; readonly kind: 'link'; readonly href: string }
  | { readonly ccw: string; readonly kind: 'keydown'; readonly event: KeyEventDto }
  | { readonly ccw: string; readonly kind: 'focus' }
  | { readonly ccw: string; readonly kind: 'blur' }
  /** Answer to a `find` control: `active` is 1-based, 0 when there are no matches. */
  | { readonly ccw: string; readonly kind: 'findResult'; readonly matches: number; readonly active: number }
  | { readonly ccw: string; readonly kind: 'comments'; readonly event: CommentsHostEvent };

export type FindDirection = 'restart' | 'next' | 'previous';

/**
 * Control messages the shell posts into a webview. Extension messages are posted as-is
 * (exactly what the extension passed to `webview.postMessage`), so these carry a marker.
 */
export type ShellToWebviewControl =
  | { readonly ccwControl: 'theme'; readonly theme: ThemeData }
  | {
      readonly ccwControl: 'find';
      readonly text: string;
      readonly matchCase: boolean;
      readonly direction: FindDirection;
    }
  | { readonly ccwControl: 'findStop' }
  /** The comment blocks to show above the input (pages with `commentsAnchor` only); null: none. */
  | { readonly ccwControl: 'comments'; readonly view: CommentsViewDto | null }
  /** Translate the extension's UI text with this table from now on; null: show it as it was. */
  | { readonly ccwControl: 'translations'; readonly translations: ExtensionTranslations | null };
