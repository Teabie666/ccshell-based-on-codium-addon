/** Builds the `vscode.ExtensionContext` handed to `activate`. */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { Emitter } from '../../platform/event';
import type { CompatHost } from './host';
import type { Memento } from './memento';
import { ExtensionKind, ExtensionMode } from './types';
import { Uri } from './uri';

export interface ExtensionObject {
  readonly id: string;
  readonly extensionUri: vscode.Uri;
  readonly extensionPath: string;
  readonly isActive: boolean;
  readonly packageJSON: Readonly<Record<string, unknown>>;
  readonly extensionKind: ExtensionKind;
  readonly exports: unknown;
  activate(): Promise<unknown>;
}

export function createExtensionObject(host: CompatHost, getExports: () => unknown): ExtensionObject {
  return {
    id: host.extension.id,
    extensionUri: Uri.file(host.extension.path),
    extensionPath: host.extension.path,
    isActive: true,
    packageJSON: host.extension.packageJson,
    extensionKind: ExtensionKind.Workspace,
    get exports() {
      return getExports();
    },
    activate: () => Promise.resolve(getExports()),
  };
}

/** In-memory SecretStorage; the Claude Code extension does not use VS Code secrets. */
class MemorySecretStorage {
  private readonly values = new Map<string, string>();
  private readonly changeEmitter = new Emitter<{ key: string }>();
  readonly onDidChange = this.changeEmitter.event;

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }

  store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    this.changeEmitter.fire({ key });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.values.delete(key);
    this.changeEmitter.fire({ key });
    return Promise.resolve();
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.values.keys()]);
  }
}

/** Terminal environment contributions; ccshell has no integrated terminal, so this only records. */
class EnvironmentVariableCollection {
  persistent = true;
  description: string | undefined;
  private readonly entries = new Map<string, { value: string; type: number }>();

  replace(variable: string, value: string): void {
    this.entries.set(variable, { value, type: 1 });
  }

  append(variable: string, value: string): void {
    this.entries.set(variable, { value, type: 2 });
  }

  prepend(variable: string, value: string): void {
    this.entries.set(variable, { value, type: 3 });
  }

  get(variable: string): { value: string; type: number } | undefined {
    return this.entries.get(variable);
  }

  forEach(callback: (variable: string, mutator: { value: string; type: number }) => void): void {
    this.entries.forEach((mutator, variable) => callback(variable, mutator));
  }

  delete(variable: string): void {
    this.entries.delete(variable);
  }

  clear(): void {
    this.entries.clear();
  }

  getScoped(): EnvironmentVariableCollection {
    return this;
  }

  [Symbol.iterator](): IterableIterator<[string, { value: string; type: number }]> {
    return this.entries[Symbol.iterator]();
  }
}

export function createExtensionContext(
  host: CompatHost,
  globalState: Memento,
  workspaceState: Memento,
  extension: ExtensionObject,
): vscode.ExtensionContext {
  const logDir = path.join(host.paths.logs, 'exthost', host.extension.id);
  for (const dir of [host.paths.globalStorage, host.paths.workspaceStorage, logDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const context = {
    subscriptions: [] as { dispose(): unknown }[],
    workspaceState,
    globalState,
    secrets: new MemorySecretStorage(),
    extensionUri: Uri.file(host.extension.path),
    extensionPath: host.extension.path,
    environmentVariableCollection: new EnvironmentVariableCollection(),
    asAbsolutePath: (relativePath: string) => path.join(host.extension.path, relativePath),
    storageUri: Uri.file(host.paths.workspaceStorage),
    storagePath: host.paths.workspaceStorage,
    globalStorageUri: Uri.file(host.paths.globalStorage),
    globalStoragePath: host.paths.globalStorage,
    logUri: Uri.file(logDir),
    logPath: logDir,
    extensionMode: ExtensionMode.Production,
    extension,
    languageModelAccessInformation: {
      onDidChange: new Emitter<void>().event,
      canSendRequest: () => undefined,
    },
  };
  return context as unknown as vscode.ExtensionContext;
}
