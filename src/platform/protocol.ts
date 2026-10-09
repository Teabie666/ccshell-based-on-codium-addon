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
}

export interface WebviewDocument {
  readonly webviewId: string;
  /** The HTML exactly as the extension assigned it to `webview.html`. */
  readonly html: string;
  /** Absolute directories the webview may load resources from. */
  readonly resourceRoots: readonly string[];
  /** Last value passed to `setState`, restored into `getState()` on reload. */
  readonly state?: unknown;
}

export interface IconPathDto {
  readonly light: string;
  readonly dark: string;
}

export interface PanelCreateParams {
  readonly panelId: string;
  readonly webviewId: string;
  readonly viewType: string;
  readonly title: string;
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

/** What the extension declares in its package.json that the shell shows itself. */
export interface ExtensionContributions {
  readonly commands: readonly CommandContribution[];
  /** By menu id, e.g. `webview/context`. */
  readonly menus: Readonly<Record<string, readonly MenuItemContribution[]>>;
}

/** One entry the renderer adds to a webview's right-click menu. */
export interface ContextMenuItemDto {
  /** Sent back in the `contextMenuAction` event when the item is clicked. */
  readonly id: string;
  readonly label: string;
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
  /** The `ccshell.language` setting and the language this run shows. */
  'app.getLanguage': (p: void) => { setting: UiLanguageSetting; running: UiLanguage };
  /** Saves `ccshell.language`; main answers with `languageChanged` if a restart is needed. */
  'app.setLanguage': (p: { setting: UiLanguageSetting }) => void;
  /** Quits and starts again with the same arguments (open conversations are restored). */
  'app.relaunch': (p: void) => void;
  'os.openExternal': (p: { url: string }) => boolean;
  /** A system notification; also flashes the taskbar button. Only shown while unfocused. */
  'os.notify': (p: { title: string; body: string }) => void;
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
};

export interface MainEventMessage<K extends keyof MainEventsForRenderer = keyof MainEventsForRenderer> {
  readonly type: typeof IpcChannel.Event;
  readonly name: K;
  readonly payload: MainEventsForRenderer[K];
}

/** IPC channel names used by the preload bridge. */
export const IpcChannel = {
  /** renderer -> main request/response, carries an RPC envelope. */
  Rpc: 'ccshell:rpc',
  /** main -> renderer, transfers the extension host MessagePort. */
  ExtHostPort: 'ccshell:exthost-port',
  /** main -> renderer events (MainEventsForRenderer). */
  Event: 'ccshell:event',
} as const;

// ---------------------------------------------------------------------------
// renderer <-> webview iframes (window.postMessage)
// ---------------------------------------------------------------------------

/** Data the shell injects into each webview document before the extension's scripts run. */
export interface WebviewBootstrapData {
  readonly webviewId: string;
  readonly state: unknown;
  readonly theme: ThemeData;
}

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
  | { readonly ccw: string; readonly kind: 'findResult'; readonly matches: number; readonly active: number };

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
  | { readonly ccwControl: 'findStop' };
