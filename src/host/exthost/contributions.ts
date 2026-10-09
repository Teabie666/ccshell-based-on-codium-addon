/**
 * The parts of the extension's `contributes` (package.json) that the shell shows itself:
 * command titles and menus. The manifest is not ours, so entries are checked one by one
 * and malformed ones are skipped instead of failing the whole read.
 */

import type { CommandContribution, ExtensionContributions, MenuItemContribution } from '../../platform/protocol';

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function readContributions(packageJson: Readonly<Record<string, unknown>>): ExtensionContributions {
  const contributes = asRecord(packageJson.contributes);

  const commands = asArray(contributes?.commands).flatMap((entry): CommandContribution[] => {
    const command = asRecord(entry);
    if (typeof command?.command !== 'string' || typeof command.title !== 'string') {
      return [];
    }
    return [{ command: command.command, title: command.title, category: optionalString(command.category) }];
  });

  const menus: Record<string, MenuItemContribution[]> = {};
  for (const [menuId, items] of Object.entries(asRecord(contributes?.menus) ?? {})) {
    menus[menuId] = asArray(items).flatMap((entry): MenuItemContribution[] => {
      const item = asRecord(entry);
      // Submenu entries carry `submenu` instead of `command`; the shell has no submenus yet.
      if (typeof item?.command !== 'string') {
        return [];
      }
      return [{ command: item.command, when: optionalString(item.when), group: optionalString(item.group) }];
    });
  }

  return { commands, menus };
}
