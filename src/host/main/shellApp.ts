/**
 * The main-process composition root for one window: owns the settings and state stores,
 * the window, and the extension host, and wires their RPC handlers together.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { app, clipboard, dialog, ipcMain, MessageChannelMain, session, shell } from 'electron';
import type { ParamsOf, ResultOf } from '../../platform/ipc';
import { Disposable, toDisposable } from '../../platform/lifecycle';
import type { ILogger, LogLevel } from '../../platform/log';
import {
  LANGUAGE_SETTING,
  parseLanguageSetting,
  resolveUiLanguage,
  setUiLanguage,
  type UiLanguage,
} from '../../platform/nls';
import {
  IpcChannel,
  type AppInfo,
  type ExtHostInitData,
  type MainApiForRenderer,
  type ThemeData,
} from '../../platform/protocol';
import { APP_ORIGIN } from '../../platform/webviewUrls';
import { languagePack } from '../../nls/packs';
import { workspaceKey } from '../node/paths';
import type { AppPaths } from './appPaths';
import { installCcwProtocol } from './ccwProtocol';
import type { CliArgs } from './cli';
import { locateClaudeExtension, type LocatedExtension } from './extensionLocator';
import { ExtHostProcess } from './extHostProcess';
import { t } from './messages';
import { SettingsStore } from './settingsStore';
import { ShellWindow, isExternalUrl, type WindowState } from './shellWindow';
import { StateStore } from './stateStore';
import { DEFAULT_THEME_ID, listThemeSummaries, loadTheme, withFontVariables } from './themes';
import { WebviewDocumentStore } from './webviewDocuments';

/** The VS Code version we report to the extension. It gates features on this number. */
export const VSCODE_COMPAT_VERSION = '1.121.0';

const THEME_SETTING = 'ccshell.theme';
/** Settings that change the theme data (colors or font variables). */
const THEME_SETTING_KEYS = new Set([
  THEME_SETTING,
  'workbench.fontFamily',
  'workbench.fontSize',
  'editor.fontFamily',
  'editor.fontSize',
  'editor.fontWeight',
]);
const WINDOW_STATE_KEY = 'ccshell.window';

export interface ShellEnvironment {
  readonly args: CliArgs;
  readonly paths: AppPaths;
  /** Directory containing main.js, preload.js, exthost.js, renderer/, themes/. */
  readonly appDir: string;
  readonly logger: ILogger;
  readonly logLevel: LogLevel;
}

type RendererHandlers = {
  [M in keyof MainApiForRenderer]: (
    params: ParamsOf<MainApiForRenderer, M>,
  ) => ResultOf<MainApiForRenderer, M> | Promise<ResultOf<MainApiForRenderer, M>>;
};

export class ShellApp extends Disposable {
  private readonly logger: ILogger;
  private readonly settings: SettingsStore;
  private readonly globalState: StateStore;
  private readonly workspaceState: StateStore;
  private readonly workspaceFolders: string[];
  private readonly workspaceKey: string;
  private readonly documents: WebviewDocumentStore;
  private readonly themesDir: string;
  /** The display language of this run; a different setting applies after a restart. */
  private readonly language: UiLanguage;
  private theme: ThemeData;
  private extension: LocatedExtension | undefined;
  private window: ShellWindow | undefined;
  private extHost: ExtHostProcess | undefined;
  private quitting = false;

  constructor(private readonly env: ShellEnvironment) {
    super();
    this.logger = env.logger;
    this.settings = this.register(new SettingsStore(env.paths.settingsFile, this.logger.child('settings')));
    this.language = this.wantedLanguage();
    setUiLanguage(this.language, languagePack(this.language));
    this.logger.info(`display language: ${this.language}`);
    this.globalState = new StateStore(env.paths.globalStateFile, this.logger.child('state'));
    this.workspaceFolders = [resolveWorkspaceFolder(env.args.folder, this.logger)];
    this.workspaceKey = workspaceKey(this.workspaceFolders);
    this.workspaceState = new StateStore(
      env.paths.workspaceStateFile(this.workspaceKey),
      this.logger.child('state'),
    );
    this.themesDir = path.join(env.appDir, 'themes');
    const themeId = env.args.theme ?? stringSetting(this.settings.all[THEME_SETTING]) ?? DEFAULT_THEME_ID;
    this.theme = withFontVariables(loadTheme(this.themesDir, themeId, this.logger), this.settings.all);
    const bootstrap = fs.readFileSync(path.join(env.appDir, 'webview-bootstrap.js'), 'utf8');
    this.documents = new WebviewDocumentStore(bootstrap, () => this.theme);
  }

  async start(): Promise<void> {
    this.extension = locateClaudeExtension(this.env.args.extensionDir);
    if (!this.extension) {
      dialog.showErrorBox('ccshell', t('extensionNotFound'));
      app.quit();
      return;
    }
    this.logger.info(
      `Claude Code ${this.extension.version} from ${this.extension.path} (via ${this.extension.source})`,
    );
    this.logger.info(`workspace: ${this.workspaceFolders.join(', ')}`);

    installCcwProtocol(session.defaultSession, {
      appDir: path.join(this.env.appDir, 'renderer'),
      documents: this.documents,
      imageRoots: () => this.workspaceFolders,
      logger: this.logger.child('ccw'),
    });
    this.registerRendererHandlers();
    this.settings.watch();
    this.register(
      this.settings.onDidChange(({ keys }) => {
        this.extHost?.rpc.notify('settings.didChange', { settings: this.settings.all, keys });
        this.window?.emit('settingsChanged', { values: this.settings.all, keys });
        if (keys.some((key) => THEME_SETTING_KEYS.has(key))) {
          this.reloadTheme();
        }
        if (keys.includes(LANGUAGE_SETTING)) {
          const wanted = this.wantedLanguage();
          if (wanted !== this.language) {
            this.window?.emit('languageChanged', { language: wanted });
          }
        }
      }),
    );

    const window = new ShellWindow({
      theme: this.theme,
      preloadPath: path.join(this.env.appDir, 'preload.js'),
      logger: this.logger.child('window'),
      openDevTools: this.env.args.devtools,
      state: (this.globalState.get(WINDOW_STATE_KEY) as WindowState | undefined) ?? {},
      openExternal: (url) => void this.openExternal(url),
    });
    this.window = this.register(window);
    window.window.webContents.on('did-finish-load', () => {
      void this.startExtHost().catch((error: unknown) => this.logger.error('failed to start extension host', error));
    });
    window.window.on('close', (event) => {
      if (this.quitting) {
        return;
      }
      event.preventDefault();
      void this.quit();
    });
    await window.load();
  }

  async quit(): Promise<void> {
    if (this.quitting) {
      return;
    }
    this.quitting = true;
    this.logger.info('shutting down');
    if (this.window) {
      this.globalState.set(WINDOW_STATE_KEY, this.window.state);
    }
    await this.extHost?.shutdown();
    await Promise.all([this.globalState.flush(), this.workspaceState.flush()]);
    this.window?.window.destroy();
    app.quit();
  }

  /** Synchronous last-chance persistence for abrupt exits. */
  flushSync(): void {
    this.globalState.flushSync();
    this.workspaceState.flushSync();
  }

  private async startExtHost(): Promise<void> {
    const window = this.window;
    const extension = this.extension;
    if (!window || !extension) {
      return;
    }
    if (this.extHost) {
      // The renderer reloaded: its webviews are gone, so start from a clean extension host.
      this.logger.info('renderer reloaded; restarting extension host');
      const previous = this.extHost;
      this.extHost = undefined;
      await previous.shutdown();
      previous.dispose();
    }
    const host = await ExtHostProcess.start(
      path.join(this.env.appDir, 'exthost.js'),
      this.logger.child('exthost-process'),
    );
    this.extHost = host;
    this.registerExtHostHandlers(host);
    host.onDidExit(({ expected, code }) => {
      if (!expected && !this.quitting && this.extHost === host) {
        // The renderer shows a banner with a restart button (app.restartExtensionHost).
        window.emit('extensionHostState', {
          state: 'crashed',
          detail: t('extensionHostExited', code ?? '?', this.env.paths.sessionLogs),
        });
      }
    });

    const { port1, port2 } = new MessageChannelMain();
    await host.rpc.call('init', this.createInitData(extension), [port1]);
    window.sendExtHostPort(port2);
    window.emit('extensionHostState', { state: 'running' });
  }

  private wantedLanguage(): UiLanguage {
    return resolveUiLanguage(this.settings.all[LANGUAGE_SETTING], app.getPreferredSystemLanguages());
  }

  /** Recomputes the theme from settings (theme id, fonts) and pushes it to the window. */
  private reloadTheme(): void {
    const id = stringSetting(this.settings.all[THEME_SETTING]) ?? DEFAULT_THEME_ID;
    this.applyTheme(withFontVariables(loadTheme(this.themesDir, id, this.logger), this.settings.all));
  }

  private applyTheme(theme: ThemeData): void {
    this.theme = theme;
    this.window?.setTheme(theme);
    this.window?.emit('themeChanged', theme);
  }

  private registerExtHostHandlers(host: ExtHostProcess): void {
    const rpc = host.rpc;
    rpc.handle('exthost.activated', ({ extensionVersion }) => {
      this.logger.info(`Claude Code ${extensionVersion} activated`);
    });
    rpc.handle('exthost.activationFailed', ({ message, stack }) => {
      this.logger.error(`Claude Code failed to activate: ${message}\n${stack ?? ''}`);
      if (this.window) {
        void dialog.showMessageBox(this.window.window, {
          type: 'error',
          message: t('extensionFailedToStart'),
          detail: message,
        });
      }
    });
    rpc.handle('webview.setDocument', (document) => this.documents.set(document));
    rpc.handle('webview.releaseDocument', ({ webviewId }) => this.documents.release(webviewId));
    rpc.handle('os.openExternal', ({ url }) => this.openExternal(url));
    rpc.handle('os.clipboardRead', () => clipboard.readText());
    rpc.handle('os.clipboardWrite', ({ text }) => clipboard.writeText(text));
    rpc.handle('storage.set', ({ scope, key, value }) => {
      (scope === 'global' ? this.globalState : this.workspaceState).set(key, value);
    });
    rpc.handle('settings.set', ({ key, value }) => this.settings.set(key, value));
  }

  private registerRendererHandlers(): void {
    const handlers: RendererHandlers = {
      'app.getInitData': () => ({
        theme: this.theme,
        workspaceFolders: this.workspaceFolders,
        appVersion: app.getVersion(),
        language: this.language,
      }),
      'app.listThemes': () => listThemeSummaries(this.themesDir),
      'app.setTheme': async ({ id }) => {
        const theme = withFontVariables(loadTheme(this.themesDir, id, this.logger), this.settings.all);
        this.applyTheme(theme);
        await this.settings.set(THEME_SETTING, theme.id);
        return theme;
      },
      'app.restartExtensionHost': () => this.startExtHost(),
      'app.getLanguage': () => ({
        setting: parseLanguageSetting(this.settings.all[LANGUAGE_SETTING]),
        running: this.language,
      }),
      'app.setLanguage': ({ setting }) => {
        const parsed = parseLanguageSetting(setting);
        // `auto` is the default, so it is stored by removing the key.
        return this.settings.set(LANGUAGE_SETTING, parsed === 'auto' ? undefined : parsed);
      },
      'app.relaunch': () => {
        app.relaunch();
        void this.quit();
      },
      'os.openExternal': ({ url }) => this.openExternal(url),
      'os.notify': ({ title, body }) => this.window?.notify(title, body),
      'settings.read': () => ({ values: { ...this.settings.all }, filePath: this.settings.filePath }),
      'settings.update': ({ key, value }) => this.settings.set(key, value),
      'window.toggleDevTools': () => this.window?.window.webContents.toggleDevTools(),
      'window.setKeybindings': ({ chords }) => this.window?.setInterceptedChords(chords),
      'window.zoom': ({ delta }) => this.window?.zoom(delta) ?? 0,
      'window.setWebviewMenu': ({ webviewId, groups }) => this.window?.setWebviewMenu(webviewId, groups),
    };
    ipcMain.handle(IpcChannel.Rpc, async (event, method: unknown, params: unknown) => {
      if (!event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`)) {
        throw new Error('Rejected IPC from an unexpected frame');
      }
      if (typeof method !== 'string' || !Object.hasOwn(handlers, method)) {
        throw new Error(`Unknown method ${String(method)}`);
      }
      const handler = handlers[method as keyof MainApiForRenderer] as (p: unknown) => unknown;
      return handler(params);
    });
    this.register(toDisposable(() => ipcMain.removeHandler(IpcChannel.Rpc)));
  }

  private createInitData(extension: LocatedExtension): ExtHostInitData {
    const paths = this.env.paths;
    return {
      extensionPath: extension.path,
      workspaceFolders: this.workspaceFolders,
      paths: {
        userData: paths.root,
        logs: paths.sessionLogs,
        globalStorage: paths.extensionGlobalStorage,
        workspaceStorage: paths.extensionWorkspaceStorage(this.workspaceKey),
      },
      settings: this.settings.all,
      globalState: this.globalState.snapshot,
      workspaceState: this.workspaceState.snapshot,
      logLevel: this.env.logLevel,
      app: this.appInfo(),
      themeKind: this.theme.kind,
    };
  }

  private appInfo(): AppInfo {
    return {
      appName: 'ccshell (VSCodium)',
      vscodeVersion: VSCODE_COMPAT_VERSION,
      uriScheme: 'ccshell',
      language: this.language,
      machineId: this.machineId(),
      sessionId: crypto.randomUUID(),
      shell: path.join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
    };
  }

  private machineId(): string {
    const file = path.join(this.env.paths.root, 'machineid');
    try {
      const existing = fs.readFileSync(file, 'utf8').trim();
      if (/^[0-9a-f]{64}$/.test(existing)) {
        return existing;
      }
    } catch {
      // First run: create one below.
    }
    const id = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, id, 'utf8');
    return id;
  }

  private async openExternal(url: string): Promise<boolean> {
    if (!isExternalUrl(url)) {
      this.logger.warn(`refused to open non-web URL externally: ${url}`);
      return false;
    }
    await shell.openExternal(url);
    return true;
  }
}

function resolveWorkspaceFolder(folder: string | undefined, logger: ILogger): string {
  if (folder) {
    try {
      if (fs.statSync(folder).isDirectory()) {
        return folder;
      }
    } catch {
      // Fall through to the home directory.
    }
    logger.warn(`workspace folder ${folder} does not exist; using the home directory`);
  }
  return os.homedir();
}

function stringSetting(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
