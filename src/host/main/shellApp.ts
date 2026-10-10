/**
 * The main-process composition root: owns what all windows share (settings, global state,
 * theme, display language, webview documents, the located extension, the ccw: protocol)
 * and the windows themselves. Each window (WindowContext) owns its workspace and its
 * extension host.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { app, dialog, ipcMain, session, shell } from 'electron';
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
import { TRANSLATE_EXTENSION_UI_SETTING, translateExtensionUi } from '../../platform/extensionStrings';
import {
  IpcChannel,
  type AppInfo,
  type ExtensionTranslations,
  type MainApiForRenderer,
  type MainEventsForRenderer,
  type ThemeData,
} from '../../platform/protocol';
import { APP_ORIGIN } from '../../platform/webviewUrls';
import { extensionTranslations } from '../../nls/extensionPacks';
import { languagePack } from '../../nls/packs';
import type { AppPaths } from './appPaths';
import { installCcwProtocol } from './ccwProtocol';
import type { CliArgs } from './cli';
import { locateClaudeExtension, type LocatedExtension } from './extensionLocator';
import { t } from './messages';
import { SettingsStore } from './settingsStore';
import { isExternalUrl, nextZoomLevel } from './shellWindow';
import { StateStore } from './stateStore';
import { DEFAULT_THEME_ID, listThemeSummaries, loadTheme, withFontVariables } from './themes';
import { WebviewDocumentStore } from './webviewDocuments';
import { WindowContext, type WindowHost } from './windowContext';
import {
  cascade,
  foldersToOpen,
  parsePlacement,
  sameFolder,
  WindowHistory,
  type WindowPlacement,
} from './windowHistory';

/** The VS Code version we report to the extension. It gates features on this number. */
export const VSCODE_COMPAT_VERSION = '1.121.0';

const THEME_SETTING = 'vilaus.theme';
/** Settings that change the theme data (colors or font variables). */
const THEME_SETTING_KEYS = new Set([
  THEME_SETTING,
  'workbench.fontFamily',
  'workbench.fontSize',
  'editor.fontFamily',
  'editor.fontSize',
  'editor.fontWeight',
]);
/** Where the one window's placement and zoom were kept before there were several windows. */
const LEGACY_WINDOW_STATE_KEY = 'vilaus.window';

export interface ShellEnvironment {
  readonly args: CliArgs;
  readonly paths: AppPaths;
  /** Directory containing main.js, preload.js, exthost.js, renderer/, themes/. */
  readonly appDir: string;
  readonly logger: ILogger;
  readonly logLevel: LogLevel;
}

/** Handlers for the page's calls; `window` is the window whose page called. */
type RendererHandlers = {
  [M in keyof MainApiForRenderer]: (
    params: ParamsOf<MainApiForRenderer, M>,
    window: WindowContext,
  ) => ResultOf<MainApiForRenderer, M> | Promise<ResultOf<MainApiForRenderer, M>>;
};

export class ShellApp extends Disposable implements WindowHost {
  readonly logger: ILogger;
  readonly settings: SettingsStore;
  readonly globalState: StateStore;
  readonly documents: WebviewDocumentStore;
  /** The display language of this run; a different setting applies after a restart. */
  readonly language: UiLanguage;
  readonly extensionTable: ExtensionTranslations | undefined;
  private readonly shellState: StateStore;
  private readonly history: WindowHistory;
  private readonly themesDir: string;
  private currentTheme: ThemeData;
  private currentZoom: number;
  /** The old single window's placement, for the first window until each folder has its own. */
  private readonly legacyPlacement: WindowPlacement | undefined;
  private located: LocatedExtension | undefined;
  /** Open windows; the most recently focused one last. */
  private readonly windows: WindowContext[] = [];
  private nextWindowId = 1;
  private quitting = false;
  private cachedMachineId: string | undefined;

  constructor(readonly env: ShellEnvironment) {
    super();
    this.logger = env.logger;
    this.settings = this.register(new SettingsStore(env.paths.settingsFile, this.logger.child('settings')));
    this.language = this.wantedLanguage();
    setUiLanguage(this.language, languagePack(this.language));
    this.logger.info(`display language: ${this.language}`);
    this.globalState = new StateStore(env.paths.globalStateFile, this.logger.child('state'));
    this.shellState = new StateStore(env.paths.shellStateFile, this.logger.child('state'));
    this.history = new WindowHistory(this.shellState);
    const legacy = this.globalState.get(LEGACY_WINDOW_STATE_KEY) as { zoomLevel?: unknown } | undefined;
    this.legacyPlacement = parsePlacement(legacy);
    if (legacy !== undefined) {
      if (this.history.zoomLevel() === undefined && typeof legacy.zoomLevel === 'number') {
        this.history.setZoomLevel(legacy.zoomLevel);
      }
      this.globalState.set(LEGACY_WINDOW_STATE_KEY, undefined);
    }
    this.currentZoom = this.history.zoomLevel() ?? 0;
    this.themesDir = path.join(env.appDir, 'themes');
    const themeId = env.args.theme ?? stringSetting(this.settings.all[THEME_SETTING]) ?? DEFAULT_THEME_ID;
    this.currentTheme = withFontVariables(loadTheme(this.themesDir, themeId, this.logger), this.settings.all);
    const bootstrap = fs.readFileSync(path.join(env.appDir, 'webview-bootstrap.js'), 'utf8');
    this.extensionTable = extensionTranslations(this.language);
    this.documents = new WebviewDocumentStore(bootstrap, () => this.theme, () => this.extensionTranslations());
  }

  get theme(): ThemeData {
    return this.currentTheme;
  }

  get zoomLevel(): number {
    return this.currentZoom;
  }

  get extension(): LocatedExtension {
    if (!this.located) {
      throw new Error('the Claude Code extension has not been located');
    }
    return this.located;
  }

  async start(): Promise<void> {
    this.located = locateClaudeExtension(this.env.args.extensionDir);
    if (!this.located) {
      dialog.showErrorBox('Vilausity', t('extensionNotFound'));
      app.quit();
      return;
    }
    this.logger.info(`Claude Code ${this.located.version} from ${this.located.path} (via ${this.located.source})`);

    installCcwProtocol(session.defaultSession, {
      appDir: path.join(this.env.appDir, 'renderer'),
      documents: this.documents,
      imageRoots: () => this.windows.flatMap((window) => window.folders),
      logger: this.logger.child('ccw'),
    });
    this.registerRendererHandlers();
    this.settings.watch();
    this.register(this.settings.onDidChange(({ keys }) => this.settingsChanged(keys)));
    // A quit from elsewhere (app.quit()) would close the windows one by one, and only the
    // last would be restored; quit the way the Exit command does instead.
    const onBeforeQuit = (event: Electron.Event): void => {
      if (!this.quitting) {
        event.preventDefault();
        void this.quit();
      }
    };
    app.on('before-quit', onBeforeQuit);
    this.register(toDisposable(() => app.off('before-quit', onBeforeQuit)));
    const folders = foldersToOpen({
      folder: this.env.args.folder ? resolveWorkspaceFolder(this.env.args.folder, this.logger) : undefined,
      restoreAll: this.history.takeRestoreAll(),
      previous: this.history.openWindows(),
      exists: isDirectory,
      fallback: os.homedir(),
    });
    for (const folder of folders) {
      await this.openWindow(folder);
    }
  }

  /** Opens `folder` in a window of its own, or brings the window that shows it to the front. */
  async openWindow(folder: string): Promise<WindowContext> {
    const existing = this.windowFor(folder);
    if (existing) {
      existing.focus();
      return existing;
    }
    const window = new WindowContext(this, {
      id: this.nextWindowId++,
      folder,
      placement: this.placementFor(folder),
    });
    this.windows.push(window);
    window.browserWindow.on('focus', () => this.markActive(window));
    this.history.addRecent(folder);
    this.rememberOpenWindows();
    this.logger.info(`window ${window.id}: ${folder}`);
    await window.load();
    return window;
  }

  requestClose(window: WindowContext): void {
    if (this.quitting) {
      return;
    }
    if (this.windows.length <= 1) {
      // The last window: it is the one to restore at the next start.
      void this.quit();
    } else {
      void this.closeWindow(window);
    }
  }

  /** Closes every window; all of them open again at the next start. */
  async quit(): Promise<void> {
    if (this.quitting) {
      return;
    }
    this.quitting = true;
    this.logger.info('shutting down');
    for (const window of this.windows) {
      this.history.rememberPlacement(window.folder, window.window.placement);
    }
    this.rememberOpenWindows();
    await Promise.all(this.windows.map((window) => window.shutdown()));
    await Promise.all([this.globalState.flush(), this.shellState.flush()]);
    for (const window of this.windows.splice(0)) {
      window.destroy();
    }
    app.quit();
  }

  /** Quits and starts again with every window that is open now, whatever the command line says. */
  relaunch(): void {
    this.history.setRestoreAll(true);
    app.relaunch();
    void this.quit();
  }

  /** Synchronous last-chance persistence for abrupt exits. */
  flushSync(): void {
    this.globalState.flushSync();
    this.shellState.flushSync();
    for (const window of this.windows) {
      window.flushSync();
    }
  }

  globalStateChanged(source: WindowContext, key: string, value: unknown): void {
    for (const window of this.windows) {
      if (window !== source) {
        window.globalStateChanged(key, value);
      }
    }
  }

  appInfo(): AppInfo {
    return {
      appName: 'Vilausity (VSCodium)',
      vscodeVersion: VSCODE_COMPAT_VERSION,
      uriScheme: 'vilaus',
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

  async openExternal(url: string): Promise<boolean> {
    if (!isExternalUrl(url)) {
      this.logger.warn(`refused to open non-web URL externally: ${url}`);
      return false;
    }
    await shell.openExternal(url);
    return true;
  }

  /**
   * Opens a folder in a new window, or in place of `inWindow`'s workspace. A folder that
   * some window shows already just brings that window to the front.
   */
  private async openFolder(folder: string, inWindow: WindowContext | undefined): Promise<boolean> {
    if (!isDirectory(folder)) {
      this.logger.warn(`cannot open ${folder}: not a folder`);
      this.history.removeRecent(folder);
      return false;
    }
    const existing = this.windowFor(folder);
    if (existing) {
      existing.focus();
    } else if (!inWindow) {
      await this.openWindow(folder);
    } else {
      this.history.rememberPlacement(inWindow.folder, inWindow.window.placement);
      await inWindow.switchFolder(folder);
      this.history.addRecent(folder);
      this.rememberOpenWindows();
    }
    return true;
  }

  private async closeWindow(window: WindowContext): Promise<void> {
    this.history.rememberPlacement(window.folder, window.window.placement);
    const index = this.windows.indexOf(window);
    if (index >= 0) {
      this.windows.splice(index, 1);
    }
    this.rememberOpenWindows();
    await window.shutdown();
    window.destroy();
  }

  private windowFor(folder: string): WindowContext | undefined {
    return this.windows.find((window) => sameFolder(window.folder, folder));
  }

  /** Keeps the most recently focused window last. */
  private markActive(window: WindowContext): void {
    const index = this.windows.indexOf(window);
    if (index >= 0 && index !== this.windows.length - 1) {
      this.windows.splice(index, 1);
      this.windows.push(window);
      this.rememberOpenWindows();
    }
  }

  /** Kept current, so even after a crash the next start reopens what was open. */
  private rememberOpenWindows(): void {
    this.history.setOpenWindows(this.windows.map((window) => window.folder));
  }

  /** Where a new window for `folder` goes: where it was last time, else a step off the active window. */
  private placementFor(folder: string): WindowPlacement {
    const taken = this.windows.flatMap((window) => window.window.placement.bounds ?? []);
    const saved = this.history.placement(folder) ?? (this.windows.length === 0 ? this.legacyPlacement : undefined);
    if (saved?.bounds) {
      return { ...saved, bounds: cascade(saved.bounds, taken) };
    }
    const active = this.windows.at(-1)?.window.placement;
    if (active?.bounds) {
      return { bounds: cascade(active.bounds, taken), maximized: active.maximized };
    }
    return saved ?? {};
  }

  private broadcast<K extends keyof MainEventsForRenderer>(name: K, payload: MainEventsForRenderer[K]): void {
    for (const window of this.windows) {
      window.emit(name, payload);
    }
  }

  private settingsChanged(keys: readonly string[]): void {
    for (const window of this.windows) {
      window.settingsChanged(keys);
    }
    if (keys.some((key) => THEME_SETTING_KEYS.has(key))) {
      this.reloadTheme();
    }
    if (keys.includes(TRANSLATE_EXTENSION_UI_SETTING) && this.extensionTable) {
      this.broadcast('extensionTranslationsChanged', { translations: this.extensionTranslations() ?? null });
    }
    if (keys.includes(LANGUAGE_SETTING)) {
      const wanted = this.wantedLanguage();
      if (wanted !== this.language) {
        this.broadcast('languageChanged', { language: wanted });
      }
    }
  }

  /** The table webviews translate the extension's UI with now: the setting can turn it off. */
  private extensionTranslations(): ExtensionTranslations | undefined {
    return this.extensionTable && translateExtensionUi(this.settings.all) ? this.extensionTable : undefined;
  }

  private wantedLanguage(): UiLanguage {
    return resolveUiLanguage(this.settings.all[LANGUAGE_SETTING], app.getPreferredSystemLanguages());
  }

  /** Recomputes the theme from settings (theme id, fonts) and pushes it to the windows. */
  private reloadTheme(): void {
    const id = stringSetting(this.settings.all[THEME_SETTING]) ?? DEFAULT_THEME_ID;
    this.applyTheme(withFontVariables(loadTheme(this.themesDir, id, this.logger), this.settings.all));
  }

  private applyTheme(theme: ThemeData): void {
    this.currentTheme = theme;
    for (const window of this.windows) {
      window.setTheme(theme);
    }
  }

  private registerRendererHandlers(): void {
    const handlers: RendererHandlers = {
      'app.getInitData': (_params, window) => window.rendererInitData(),
      'app.listThemes': () => listThemeSummaries(this.themesDir),
      'app.setTheme': async ({ id }) => {
        const theme = withFontVariables(loadTheme(this.themesDir, id, this.logger), this.settings.all);
        this.applyTheme(theme);
        await this.settings.set(THEME_SETTING, theme.id);
        return theme;
      },
      'app.restartExtensionHost': (_params, window) => window.restartExtensionHost(),
      'app.getLanguage': () => ({
        setting: parseLanguageSetting(this.settings.all[LANGUAGE_SETTING]),
        running: this.language,
      }),
      'app.setLanguage': ({ setting }) => {
        const parsed = parseLanguageSetting(setting);
        // `auto` is the default, so it is stored by removing the key.
        return this.settings.set(LANGUAGE_SETTING, parsed === 'auto' ? undefined : parsed);
      },
      'app.relaunch': () => this.relaunch(),
      'app.quit': () => void this.quit(),
      'os.openExternal': ({ url }) => this.openExternal(url),
      'os.notify': ({ title, body }, window) => window.window.notify(title, body),
      'os.openFolder': async ({ path: folder }) => {
        const error = await shell.openPath(folder);
        if (error) {
          this.logger.warn(`cannot open ${folder} in the file manager: ${error}`);
        }
      },
      'settings.read': () => ({ values: { ...this.settings.all }, filePath: this.settings.filePath }),
      'settings.update': ({ key, value }) => this.settings.set(key, value),
      'window.toggleDevTools': (_params, window) => window.webContents.toggleDevTools(),
      'window.pickFolder': async (_params, window) => {
        const result = await dialog.showOpenDialog(window.browserWindow, {
          properties: ['openDirectory'],
          defaultPath: path.dirname(window.folder),
        });
        return result.canceled ? undefined : result.filePaths[0];
      },
      'window.openFolder': ({ folder, newWindow }, window) => this.openFolder(folder, newWindow ? undefined : window),
      'window.recentFolders': () => this.history.recentFolders(),
      'window.shownFolders': () => this.windows.map((window) => window.folder),
      'window.close': (_params, window) => this.requestClose(window),
      'window.setKeybindings': ({ chords }, window) => window.window.setInterceptedChords(chords),
      'window.zoom': ({ delta }) => {
        // One level for all windows: Chromium zooms pages of the same origin together anyway.
        this.currentZoom = nextZoomLevel(this.currentZoom, delta);
        this.history.setZoomLevel(this.currentZoom);
        for (const window of this.windows) {
          window.window.setZoomLevel(this.currentZoom);
        }
        return this.currentZoom;
      },
      'window.setWebviewMenu': ({ webviewId, groups }, window) => window.window.setWebviewMenu(webviewId, groups),
    };
    ipcMain.handle(IpcChannel.Rpc, async (event, method: unknown, params: unknown) => {
      if (!event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`)) {
        throw new Error('Rejected IPC from an unexpected frame');
      }
      const window = this.windows.find((candidate) => candidate.webContents.id === event.sender.id);
      if (!window) {
        throw new Error('Rejected IPC from a page that is not an open window');
      }
      if (typeof method !== 'string' || !Object.hasOwn(handlers, method)) {
        throw new Error(`Unknown method ${String(method)}`);
      }
      const handler = handlers[method as keyof MainApiForRenderer] as (p: unknown, w: WindowContext) => unknown;
      return handler(params, window);
    });
    this.register(toDisposable(() => ipcMain.removeHandler(IpcChannel.Rpc)));
  }

  private machineId(): string {
    if (this.cachedMachineId) {
      return this.cachedMachineId;
    }
    const file = path.join(this.env.paths.root, 'machineid');
    try {
      const existing = fs.readFileSync(file, 'utf8').trim();
      if (/^[0-9a-f]{64}$/.test(existing)) {
        this.cachedMachineId = existing;
        return existing;
      }
    } catch {
      // First run: create one below.
    }
    const id = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, id, 'utf8');
    this.cachedMachineId = id;
    return id;
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

function isDirectory(folder: string): boolean {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

function stringSetting(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
