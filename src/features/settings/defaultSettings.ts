/**
 * Default Settings (JSON): every declared setting with its description and default, read
 * only, like VS Code's default settings. It follows new declarations (the extension's
 * settings arrive with its host).
 */

import type { IDisposable } from '../../platform/lifecycle';
import type { ILogger } from '../../platform/log';
import type { EditorPane } from '../../core/editors';
import type { SettingsService } from '../../core/settings';
import type { TextEditorService, TextViewer } from '../editor';
import { t } from './messages';
import { defaultSettingsText } from './settingItems';

const DEFAULT_SETTINGS_URI = 'vilaus-settings:/defaultSettings.json';

export class DefaultSettingsPane implements EditorPane {
  private body: HTMLElement;
  private viewer: TextViewer | undefined;
  private disposed = false;
  /** Focus asked for before Monaco loaded. */
  private focusWhenReady = false;
  private readonly subscription: IDisposable;

  constructor(container: HTMLElement, editors: TextEditorService, settings: SettingsService, logger: ILogger) {
    this.body = createBody(container);
    const text = (): string =>
      defaultSettingsText(settings.definitions, { header: t('defaultSettingsHeader'), deprecated: t('deprecated') });
    editors.createViewer(this.body, DEFAULT_SETTINGS_URI, text, 'json').then(
      (viewer) => {
        if (this.disposed) {
          viewer.dispose();
          return;
        }
        this.viewer = viewer;
        if (this.focusWhenReady) {
          viewer.focus();
        }
      },
      (error: unknown) => logger.error('showing the default settings failed', error),
    );
    this.subscription = settings.onDidChangeDefinitions(() => this.viewer?.setText(text()));
  }

  layout(): void {}

  setVisible(): void {}

  focus(): void {
    if (this.viewer) {
      this.viewer.focus();
    } else {
      this.focusWhenReady = true;
    }
  }

  relocate(container: HTMLElement): void {
    if (!this.viewer) {
      // Not created yet: it will be, wherever the body is by then.
      container.classList.add('text-editor-container');
      container.append(this.body);
      return;
    }
    const body = createBody(container);
    this.viewer.relocate(body);
    this.body.remove();
    this.body = body;
  }

  dispose(): void {
    this.disposed = true;
    this.subscription.dispose();
    this.viewer?.dispose();
  }
}

function createBody(container: HTMLElement): HTMLElement {
  container.classList.add('text-editor-container');
  const body = container.ownerDocument.createElement('div');
  body.className = 'editor-body';
  container.appendChild(body);
  return body;
}
