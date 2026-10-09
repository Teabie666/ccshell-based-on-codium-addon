/**
 * Keybindings. Rules map a chord to a command. The set of chords is mirrored to main,
 * which intercepts them before any page (including webview iframes) sees the key, and
 * sends them back here for dispatch. That way shortcuts work wherever focus is.
 */

import type { IDisposable } from '../platform/lifecycle';
import type { ILogger } from '../platform/log';
import { formatChord, normalizeChord } from '../platform/keybindings';
import type { CommandService } from './commands';
import type { ContextKeyService } from './contextKeys';

export interface KeybindingRule {
  /** e.g. `ctrl+shift+p`; see platform/keybindings.ts for the key names. */
  readonly key: string;
  readonly command: string;
  readonly args?: readonly unknown[];
  readonly when?: string;
}

export class KeybindingService {
  private readonly rules: KeybindingRule[] = [];
  private syncScheduled = false;

  constructor(
    private readonly commands: CommandService,
    private readonly contextKeys: ContextKeyService,
    private readonly syncChords: (chords: string[]) => void,
    private readonly logger: ILogger,
  ) {}

  register(rule: KeybindingRule): IDisposable {
    const normalized = { ...rule, key: normalizeChord(rule.key) };
    this.rules.push(normalized);
    this.scheduleSync();
    return {
      dispose: () => {
        const index = this.rules.indexOf(normalized);
        if (index >= 0) {
          this.rules.splice(index, 1);
          this.scheduleSync();
        }
      },
    };
  }

  /** Runs the last-registered matching rule whose when clause holds. Returns true if one ran. */
  async dispatch(chord: string): Promise<boolean> {
    const key = normalizeChord(chord);
    for (let i = this.rules.length - 1; i >= 0; i--) {
      const rule = this.rules[i]!;
      if (rule.key !== key || !this.contextKeys.evaluate(rule.when) || !this.commands.isEnabled(rule.command)) {
        continue;
      }
      try {
        await this.commands.execute(rule.command, ...(rule.args ?? []));
      } catch (error) {
        this.logger.error(`keybinding ${key} -> ${rule.command} failed`, error);
      }
      return true;
    }
    return false;
  }

  /** Display label for the first chord bound to a command, e.g. `Ctrl+Shift+P`. */
  labelFor(commandId: string): string | undefined {
    const rule = this.rules.find((r) => r.command === commandId);
    return rule ? formatChord(rule.key) : undefined;
  }

  private scheduleSync(): void {
    if (this.syncScheduled) {
      return;
    }
    this.syncScheduled = true;
    queueMicrotask(() => {
      this.syncScheduled = false;
      this.syncChords([...new Set(this.rules.map((rule) => rule.key))]);
    });
  }
}
