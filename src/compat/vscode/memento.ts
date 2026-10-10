/** `ExtensionContext.globalState` / `workspaceState`. Values are JSON, as in VS Code. */

import type * as vscode from 'vscode';
import type { StorageScope } from '../../platform/protocol';
import type { StorageBackend } from './host';

export class Memento implements vscode.Memento {
  private readonly values: Record<string, unknown>;

  constructor(
    private readonly scope: StorageScope,
    private readonly backend: StorageBackend,
  ) {
    this.values = { ...backend.initial(scope) };
    // Another window's extension changed shared state; lives as long as the process.
    backend.onDidChange((change) => {
      if (change.scope === scope) {
        this.store(change.key, change.value);
      }
    });
  }

  keys(): readonly string[] {
    return Object.keys(this.values);
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    const value = this.values[key];
    return value === undefined ? defaultValue : (value as T);
  }

  update(key: string, value: unknown): Promise<void> {
    // A JSON round trip drops functions and class identity, exactly like VS Code's storage.
    const stored = value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown);
    this.store(key, stored);
    this.backend.set(this.scope, key, stored);
    return Promise.resolve();
  }

  /** Settings Sync does not exist in vilaus. */
  setKeysForSync(_keys: readonly string[]): void {}

  private store(key: string, value: unknown): void {
    if (value === undefined) {
      delete this.values[key];
    } else {
      this.values[key] = value;
    }
  }
}
