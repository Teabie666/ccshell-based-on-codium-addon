/** The active theme: applies VS Code variables to the shell and to every webview. */

import { Emitter, type Event } from '../platform/event';
import type { IDisposable } from '../platform/lifecycle';
import type { ThemeData, ThemeSummary } from '../platform/protocol';
import type { NativeApi } from './native';
import type { WebviewFrames } from './webviewFrames';

const THEME_CLASSES = ['vscode-light', 'vscode-dark', 'vscode-high-contrast', 'vscode-high-contrast-light'];

export function applyThemeToDocument(theme: ThemeData): void {
  const style = document.documentElement.style;
  // Drop the previous theme's variables first: themes do not all define the same set.
  for (let i = style.length - 1; i >= 0; i--) {
    const property = style[i];
    if (property?.startsWith('--vscode-')) {
      style.removeProperty(property);
    }
  }
  for (const [name, value] of Object.entries(theme.variables)) {
    style.setProperty(`--${name}`, value);
  }
  const body = document.body;
  body.classList.remove(...THEME_CLASSES);
  body.classList.add(theme.kind);
  if (theme.kind === 'vscode-high-contrast-light') {
    body.classList.add('vscode-high-contrast');
  }
}

export function isDarkTheme(theme: ThemeData): boolean {
  return theme.kind === 'vscode-dark' || theme.kind === 'vscode-high-contrast';
}

export class ThemeService implements IDisposable {
  private themeValue: ThemeData;
  private readonly changeEmitter = new Emitter<ThemeData>();
  readonly onDidChange: Event<ThemeData> = this.changeEmitter.event;
  private readonly subscription: IDisposable;

  constructor(
    initial: ThemeData,
    private readonly frames: WebviewFrames,
    private readonly nativeApi: NativeApi,
  ) {
    this.themeValue = initial;
    applyThemeToDocument(initial);
    // Main is the source of truth: it emits themeChanged for picks and for settings edits.
    this.subscription = nativeApi.on('themeChanged', (theme) => this.apply(theme));
  }

  get current(): ThemeData {
    return this.themeValue;
  }

  list(): Promise<ThemeSummary[]> {
    return this.nativeApi.call('app.listThemes', undefined);
  }

  async select(id: string): Promise<void> {
    await this.nativeApi.call('app.setTheme', { id });
  }

  dispose(): void {
    this.subscription.dispose();
    this.changeEmitter.dispose();
  }

  private apply(theme: ThemeData): void {
    this.themeValue = theme;
    applyThemeToDocument(theme);
    this.frames.setTheme(theme);
    this.changeEmitter.fire(theme);
  }
}
