/**
 * `vscode.commands`: commands the extension registers, plus the built-in VS Code commands
 * it calls. Built-ins we do not support resolve to `undefined` (and are reported) rather
 * than throwing, because the extension calls many cosmetic workbench commands.
 */

import { Emitter, type Event } from '../../platform/event';
import type { ILogger } from '../../platform/log';
import { Disposable } from './types';

export type CommandHandler = (...args: unknown[]) => unknown;

export class CommandRegistry {
  private readonly commands = new Map<string, { handler: CommandHandler; thisArg: unknown }>();
  private readonly builtins = new Map<string, CommandHandler>();
  private readonly contextKeys = new Map<string, unknown>();
  private readonly contextEmitter = new Emitter<{ key: string; value: unknown }>();
  /** Fires when the extension calls `setContext`; the shell uses these for when-clauses. */
  readonly onDidChangeContext: Event<{ key: string; value: unknown }> = this.contextEmitter.event;

  constructor(
    private readonly logger: ILogger,
    private readonly reportUnimplemented: (member: string) => void,
  ) {
    this.registerBuiltin('setContext', (key, value) => {
      if (typeof key === 'string') {
        this.contextKeys.set(key, value);
        this.contextEmitter.fire({ key, value });
      }
    });
  }

  registerCommand(id: string, handler: CommandHandler, thisArg?: unknown): Disposable {
    if (this.commands.has(id)) {
      this.logger.warn(`command ${id} registered twice; keeping the newest`);
    }
    const entry = { handler, thisArg };
    this.commands.set(id, entry);
    return new Disposable(() => {
      if (this.commands.get(id) === entry) {
        this.commands.delete(id);
      }
    });
  }

  registerBuiltin(id: string, handler: CommandHandler): void {
    this.builtins.set(id, handler);
  }

  hasCommand(id: string): boolean {
    return this.commands.has(id) || this.builtins.has(id);
  }

  getContext(key: string): unknown {
    return this.contextKeys.get(key);
  }

  async executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    const registered = this.commands.get(id);
    if (registered) {
      return (await registered.handler.apply(registered.thisArg, args)) as T;
    }
    const builtin = this.builtins.get(id);
    if (builtin) {
      return (await builtin(...args)) as T;
    }
    this.reportUnimplemented(`command:${id}`);
    return undefined as T;
  }

  getCommands(filterInternal = false): Promise<string[]> {
    const ids = [...this.commands.keys(), ...this.builtins.keys()];
    return Promise.resolve(filterInternal ? ids.filter((id) => !id.startsWith('_')) : ids);
  }
}
