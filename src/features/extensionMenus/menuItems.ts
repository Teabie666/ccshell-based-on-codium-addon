/**
 * Turns the extension's `contributes.menus` into shell menu items the way VS Code reads
 * them: the title comes from `contributes.commands` (named for the UI language, see
 * messages.ts), `group@order` splits into a group and an order, and items whose
 * command the extension does not declare are dropped.
 */

import type { MenuItem } from '../../core/menus';
import type { ExtensionContributions } from '../../platform/protocol';
import { displayTitle } from './messages';

export function contributedMenuItems(contributions: ExtensionContributions, menuId: string): MenuItem[] {
  const titles = new Map(contributions.commands.map((command) => [command.command, command.title]));
  return (contributions.menus[menuId] ?? []).flatMap((item): MenuItem[] => {
    const manifestTitle = titles.get(item.command);
    if (manifestTitle === undefined) {
      return [];
    }
    const title = displayTitle(item.command, manifestTitle);
    return [{ command: item.command, title, when: item.when, ...splitGroup(item.group) }];
  });
}

/** `navigation@2` -> group `navigation`, order 2. A missing or non-numeric order is no order. */
export function splitGroup(group: string | undefined): { group?: string; order?: number } {
  if (!group) {
    return {};
  }
  const at = group.lastIndexOf('@');
  if (at <= 0) {
    return { group };
  }
  return { group: group.slice(0, at), order: Number(group.slice(at + 1)) || undefined };
}
