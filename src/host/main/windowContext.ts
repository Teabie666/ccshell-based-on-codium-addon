/**
 * One window and what belongs to it alone: its workspace (folders and workspace state),
 * the BrowserWindow, and the extension host that serves it. What the windows share
 * (settings, global state, theme, webview documents, the extension) stays in ShellApp,
 * which a window reaches through `WindowHost`.
 */

import * as path from 'node:path';
import { app, clipboard, dialog, MessageChannelMain, shell, type BrowserWindow, type WebContents } from 'electron';
import { Disposable } from '../../platform/lifecycle';
import type { ILogger } from '../../platform/log';
import type { UiLanguage } from '../../platform/nls';
import type {
  AppInfo,
  ConversationRequest,
  ExtensionTranslations,
  ExtHostInitData,
  MainEventsForRenderer,
  RendererInitData,
  ThemeData,
} from '../../platform/protocol';
import { URI } from 'vscode-uri';
import { workspaceKey } from '../node/paths';
import type { GotoTarget } from './cli';
import type { LocatedExtension } from './extensionLocator';
import { ExtHostProcess } from './extHostProcess';
import { t } from './messages';
import type { SettingsStore } from './settingsStore';
import type { ShellEnvironment } from './shellApp';
import { ShellWindow } from './shellWindow';
import { StateStore } from './stateStore';
import type { WebviewDocumentStore } from './webviewDocuments';
import type { WindowPlacement } from './windowHistory';

/** What a window needs from the application. */
export interface WindowHost {
  readonly env: ShellEnvironment;
  readonly settings: SettingsStore;
  readonly globalState: StateStore;
  readonly documents: WebviewDocumentStore;
  readonly language: UiLanguage;
  readonly theme: ThemeData;
  /** The extension UI's translations in this run's language, if there are any. */
  readonly extensionTable: ExtensionTranslations | undefined;
  readonly extension: LocatedExtension;
  appInfo(): AppInfo;
  openExternal(url: string): Promise<boolean>;
  /** The zoom level all windows share. */
  readonly zoomLevel: number;
  /** This window's extension host changed a global state value; the other windows' hosts need it too. */
  globalStateChanged(source: WindowContext, key: string, value: unknown): void;
  /** The user closed the window (its close button, Alt+F4). */
  requestClose(window: WindowContext): void;
}

export interface WindowOptions {
  /** 1, 2, ... in the order windows open during this run; names the window's log folder. */
  readonly id: number;
  readonly folder: string;
  readonly placement: WindowPlacement;
}

export class WindowContext extends Disposable {
  readonly id: number;
  readonly window: ShellWindow;
  private readonly logger: ILogger;
  private readonly logsDir: string;
  /** Marks this window's webview documents in the shared store. */
  private readonly documentOwner: string;
  private currentFolders: readonly string[] = [];
  private currentWorkspaceKey = '';
  private currentWorkspaceState: StateStore | undefined;
  private extHost: ExtHostProcess | undefined;
  /** The extension host has its init data: it takes requests now. */
  private initialized = false;
  /** Requests that wait for the extension host's init. */
  private readonly afterInit: ((extHost: ExtHostProcess) => void)[] = [];
  /** Goes into the init data: opens instead of the new conversation an empty window shows. */
  private pendingConversation: ConversationRequest | undefined;
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly host: WindowHost,
    options: WindowOptions,
  ) {
    super();
    const env = host.env;
    this.id = options.id;
    this.documentOwner = `window${options.id}`;
    this.logger = env.logger.child(`window${options.id}`);
    this.logsDir = env.paths.windowLogs(options.id);
    this.setWorkspace(options.folder);
    this.window = this.register(
      new ShellWindow({
        theme: host.theme,
        preloadPath: path.join(env.appDir, 'preload.js'),
        logger: this.logger,
        openDevTools: env.args.devtools,
        secondaryDisplay: env.args.secondaryDisplay,
        placement: options.placement,
        zoomLevel: () => host.zoomLevel,
        openExternal: (url) => void host.openExternal(url),
      }),
    );
    this.webContents.on('did-finish-load', () => {
      void this.startExtHost().catch((error: unknown) => this.logger.error('failed to start extension host', error));
    });
    this.browserWindow.on('close', (event) => {
      if (this.shutdownPromise) {
        return;
      }
      event.preventDefault();
      host.requestClose(this);
    });
  }

  get browserWindow(): BrowserWindow {
    return this.window.window;
  }

  get webContents(): WebContents {
    return this.window.window.webContents;
  }

  get folders(): readonly string[] {
    return this.currentFolders;
  }

  /** The workspace folder (a window has exactly one). */
  get folder(): string {
    return this.currentFolders[0] ?? '';
  }

  get workspaceKey(): string {
    return this.currentWorkspaceKey;
  }

  get workspaceState(): StateStore {
    if (!this.currentWorkspaceState) {
      throw new Error('the window has no workspace');
    }
    return this.currentWorkspaceState;
  }

  load(): Promise<void> {
    return this.window.load();
  }

  focus(): void {
    this.window.focus();
  }

  /** Opens a conversation (a session, a prompt) once the extension is up. */
  openConversation(request: ConversationRequest): void {
    if (this.extHost && this.initialized) {
      this.request(this.extHost.rpc.call('conversation.open', request), 'opening a conversation');
    } else {
      this.pendingConversation = request;
    }
  }

  /** Shows a file in the content pane, at a line (1-based) if given. */
  showFile(target: GotoTarget): void {
    const position = { line: (target.line ?? 1) - 1, character: (target.column ?? 1) - 1 };
    const selection = target.line ? { start: position, end: position } : undefined;
    this.whenInitialized((extHost) =>
      this.request(
        extHost.rpc.call('documents.show', { uri: URI.file(target.path).toString(), selection }),
        `opening ${target.path}`,
      ),
    );
  }

  /** Hands a vilaus:// link to the extension (after the user agrees). */
  openUri(uri: string): void {
    this.whenInitialized((extHost) => this.request(extHost.rpc.call('uri.handle', { uri }), `opening ${uri}`));
  }

  /**
   * Shows another folder in this window, the way VS Code reloads a window for a new
   * workspace: the extension host stops (the extension records the open conversations
   * under the old folder, so they come back with it), and the page reloads for the new
   * folder, which starts a new extension host.
   */
  async switchFolder(folder: string): Promise<void> {
    this.logger.info(`switching the workspace to ${folder}`);
    await this.stopExtHost();
    await this.workspaceState.flush();
    this.setWorkspace(folder);
    this.webContents.reload();
  }

  emit<K extends keyof MainEventsForRenderer>(name: K, payload: MainEventsForRenderer[K]): void {
    this.window.emit(name, payload);
  }

  rendererInitData(): RendererInitData {
    return {
      theme: this.host.theme,
      workspaceFolders: this.folders,
      appVersion: app.getVersion(),
      language: this.host.language,
    };
  }

  /** settings.json changed: both the page and the extension host read settings. */
  settingsChanged(keys: readonly string[]): void {
    const values = this.host.settings.all;
    this.extHost?.rpc.notify('settings.didChange', { settings: values, keys });
    this.window.emit('settingsChanged', { values, keys });
  }

  /** Another window changed a global state value. */
  globalStateChanged(key: string, value: unknown): void {
    this.extHost?.rpc.notify('storage.didChange', { scope: 'global', key, value });
  }

  setTheme(theme: ThemeData): void {
    this.window.setTheme(theme);
    this.window.emit('themeChanged', theme);
  }

  /** After a crash (the page's restart button). */
  restartExtensionHost(): Promise<void> {
    return this.startExtHost();
  }

  /**
   * Stops the extension host (the extension records its open conversations and stops its
   * Claude processes) and saves the workspace state. The window stays until `destroy`.
   */
  shutdown(): Promise<void> {
    this.shutdownPromise ??= (async () => {
      await this.stopExtHost();
      await this.workspaceState.flush();
    })();
    return this.shutdownPromise;
  }

  destroy(): void {
    if (!this.browserWindow.isDestroyed()) {
      this.browserWindow.destroy();
    }
    this.extHost?.dispose();
    this.dispose();
  }

  /** Synchronous last-chance persistence for abrupt exits. */
  flushSync(): void {
    this.currentWorkspaceState?.flushSync();
  }

  private setWorkspace(folder: string): void {
    this.currentFolders = [folder];
    this.currentWorkspaceKey = workspaceKey(this.currentFolders);
    this.currentWorkspaceState = new StateStore(
      this.host.env.paths.workspaceStateFile(this.currentWorkspaceKey),
      this.logger.child('state'),
    );
  }

  private whenInitialized(action: (extHost: ExtHostProcess) => void): void {
    if (this.extHost && this.initialized) {
      action(this.extHost);
    } else {
      this.afterInit.push(action);
    }
  }

  private request(pending: Promise<unknown>, what: string): void {
    pending.catch((error: unknown) => this.logger.error(`${what} failed`, error));
  }

  private async stopExtHost(): Promise<void> {
    const previous = this.extHost;
    this.extHost = undefined;
    this.initialized = false;
    if (previous) {
      await previous.shutdown();
      previous.dispose();
    }
    this.host.documents.releaseOwner(this.documentOwner);
  }

  private async startExtHost(): Promise<void> {
    if (this.shutdownPromise) {
      return;
    }
    if (this.extHost) {
      // The page reloaded (or the host crashed): its webviews are gone, so start from a clean host.
      this.logger.info('restarting extension host');
      await this.stopExtHost();
    }
    const extHost = await ExtHostProcess.start(
      path.join(this.host.env.appDir, 'exthost.js'),
      this.logger.child('exthost-process'),
    );
    if (this.shutdownPromise) {
      // The window closed while the process was starting.
      await extHost.shutdown();
      extHost.dispose();
      return;
    }
    this.extHost = extHost;
    this.registerExtHostHandlers(extHost);
    extHost.onDidExit(({ expected, code }) => {
      if (!expected && !this.shutdownPromise && this.extHost === extHost) {
        // The page shows a banner with a restart button (app.restartExtensionHost).
        this.window.emit('extensionHostState', {
          state: 'crashed',
          detail: t('extensionHostExited', code ?? '?', this.logsDir),
        });
      }
    });

    const { port1, port2 } = new MessageChannelMain();
    await extHost.rpc.call('init', this.createInitData(), [port1]);
    this.window.sendExtHostPort(port2);
    this.window.emit('extensionHostState', { state: 'running' });
    this.initialized = true;
    for (const action of this.afterInit.splice(0)) {
      action(extHost);
    }
  }

  private registerExtHostHandlers(extHost: ExtHostProcess): void {
    const rpc = extHost.rpc;
    const host = this.host;
    rpc.handle('exthost.activated', ({ extensionVersion }) => {
      this.logger.info(`Claude Code ${extensionVersion} activated`);
    });
    rpc.handle('exthost.activationFailed', ({ message, stack }) => {
      this.logger.error(`Claude Code failed to activate: ${message}\n${stack ?? ''}`);
      void dialog.showMessageBox(this.browserWindow, {
        type: 'error',
        message: t('extensionFailedToStart'),
        detail: message,
      });
    });
    rpc.handle('webview.setDocument', (document) => host.documents.set(document, this.documentOwner));
    rpc.handle('webview.releaseDocument', ({ webviewId }) => host.documents.release(webviewId));
    rpc.handle('os.openExternal', ({ url }) => host.openExternal(url));
    rpc.handle('os.clipboardRead', () => clipboard.readText());
    rpc.handle('os.clipboardWrite', ({ text }) => clipboard.writeText(text));
    rpc.handle('os.revealFile', ({ path: target }) => shell.showItemInFolder(target));
    rpc.handle('storage.set', ({ scope, key, value }) => {
      if (scope === 'workspace') {
        this.workspaceState.set(key, value);
        return;
      }
      host.globalState.set(key, value);
      host.globalStateChanged(this, key, value);
    });
    rpc.handle('settings.set', ({ key, value }) => host.settings.set(key, value));
  }

  private createInitData(): ExtHostInitData {
    const paths = this.host.env.paths;
    return {
      extensionPath: this.host.extension.path,
      workspaceFolders: this.folders,
      paths: {
        userData: paths.root,
        logs: this.logsDir,
        globalStorage: paths.extensionGlobalStorage,
        workspaceStorage: paths.extensionWorkspaceStorage(this.workspaceKey),
      },
      settings: this.host.settings.all,
      globalState: this.host.globalState.snapshot,
      workspaceState: this.workspaceState.snapshot,
      logLevel: this.host.env.logLevel,
      app: this.host.appInfo(),
      themeKind: this.host.theme.kind,
      // Whatever the setting says now: the extension host follows it as it changes.
      extensionTranslations: this.host.extensionTable,
      openConversation: this.takePendingConversation(),
    };
  }

  private takePendingConversation(): ConversationRequest | undefined {
    const request = this.pendingConversation;
    this.pendingConversation = undefined;
    return request;
  }
}
