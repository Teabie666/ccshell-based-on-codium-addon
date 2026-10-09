/**
 * Reopens the conversation panels that were open when ccshell last closed, the way VS Code
 * restores webview panels: each panel's last webview state (which carries its session id)
 * is saved, and on start the extension's own WebviewPanelSerializer revives it.
 */

import type * as vscode from 'vscode';
import type { StorageBackend } from '../../compat/vscode/host';
import type { WebviewManager } from '../../compat/vscode/webviews';
import { ViewColumn } from '../../compat/vscode/types';
import type { IDisposable } from '../../platform/lifecycle';
import type { ILogger } from '../../platform/log';

const STORAGE_KEY = 'ccshell.openPanels';
const SAVE_DELAY_MS = 500;

interface PanelRecord {
  readonly viewType: string;
  readonly title: string;
  readonly state: unknown;
  readonly active: boolean;
}

export class PanelRestore implements IDisposable {
  private timer: NodeJS.Timeout | undefined;
  private frozen = false;
  private readonly subscription: IDisposable;

  constructor(
    private readonly webviews: WebviewManager,
    private readonly storage: StorageBackend,
    private readonly logger: ILogger,
  ) {
    this.subscription = webviews.onDidChangePanels(() => this.scheduleSave());
  }

  /**
   * Revives the saved panels through the extension's serializers. Returns how many were
   * restored; the caller opens a fresh conversation when none were.
   */
  async restore(): Promise<number> {
    const saved = this.storage.initial('workspace')[STORAGE_KEY];
    const records = Array.isArray(saved) ? (saved as PanelRecord[]) : [];
    let restored = 0;
    let active: vscode.WebviewPanel | undefined;
    for (const record of records) {
      const serializer = this.webviews.serializers.get(record.viewType);
      if (!serializer || record.state === undefined) {
        continue;
      }
      const panel = this.webviews.createWebviewPanel(
        record.viewType,
        record.title,
        { viewColumn: ViewColumn.One as unknown as vscode.ViewColumn, preserveFocus: true },
        { enableScripts: true, retainContextWhenHidden: true },
      );
      // The revived document's getState() must return what the page saved last time.
      panel.webview.state = record.state;
      try {
        await serializer.deserializeWebviewPanel(panel, record.state);
        restored++;
        if (record.active) {
          active = panel;
        }
      } catch (error) {
        this.logger.error(`could not restore a ${record.viewType} panel`, error);
        panel.dispose();
      }
    }
    active?.reveal(undefined, false);
    this.logger.info(`restored ${restored} of ${records.length} panels`);
    return restored;
  }

  /** Writes the final list and stops tracking (before the extension deactivates and closes panels). */
  freeze(): void {
    clearTimeout(this.timer);
    this.save();
    this.frozen = true;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.subscription.dispose();
  }

  private scheduleSave(): void {
    if (this.frozen) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), SAVE_DELAY_MS);
  }

  private save(): void {
    if (this.frozen) {
      return;
    }
    const records: PanelRecord[] = this.webviews.allPanels.map((panel) => ({
      viewType: panel.viewType,
      title: panel.title,
      state: panel.webview.state,
      active: panel.active,
    }));
    this.storage.set('workspace', STORAGE_KEY, records);
  }
}
