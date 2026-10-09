/**
 * Menus: the contribution point for context menus. An item names a command and a `when`
 * clause; a menu shows the items whose clause holds, grouped and ordered like VS Code's
 * MenuInfo: `navigation` first, other groups by name, items without a group last; inside
 * a group by `order`, then by title.
 */

import { Emitter, type Event } from '../platform/event';
import type { IDisposable } from '../platform/lifecycle';
import type { ILogger } from '../platform/log';
import { evaluateWhen, type ContextKeyService } from './contextKeys';

/** Menu ids, named as in VS Code's `contributes.menus`. */
export const MenuId = {
  /** Right-click inside a webview. The `webviewId` context key holds the webview's viewType. */
  WebviewContext: 'webview/context',
  /**
   * Buttons that float next to text the user selected in a content pane editor (Vilausity's
   * own menu). Their command gets an `EditorSelectionContext` (core/editors.ts).
   */
  EditorSelection: 'editor/selection',
} as const;

export interface MenuItem {
  readonly command: string;
  readonly title: string;
  readonly when?: string;
  readonly group?: string;
  readonly order?: number;
  /** An icon name for menus that show icons (e.g. `comment`): the shell's `icon-<name>` style. */
  readonly icon?: string;
}

export class MenuService {
  private readonly menus = new Map<string, MenuItem[]>();
  private readonly changeEmitter = new Emitter<string>();
  /** Fires the id of a menu whose items were added or removed. */
  readonly onDidChange: Event<string> = this.changeEmitter.event;

  constructor(
    private readonly contextKeys: ContextKeyService,
    private readonly logger: ILogger,
  ) {}

  register(menuId: string, item: MenuItem): IDisposable {
    const items = this.menus.get(menuId) ?? [];
    items.push(item);
    this.menus.set(menuId, items);
    this.changeEmitter.fire(menuId);
    return {
      dispose: () => {
        const index = items.indexOf(item);
        if (index >= 0) {
          items.splice(index, 1);
          this.changeEmitter.fire(menuId);
        }
      },
    };
  }

  /**
   * The items to show now, in groups. `overlay` adds context keys for this lookup only,
   * e.g. `{ webviewId: viewType }` for the webview that was right-clicked.
   */
  getGroups(menuId: string, overlay: Readonly<Record<string, unknown>> = {}): MenuItem[][] {
    const lookup = (key: string): unknown => (Object.hasOwn(overlay, key) ? overlay[key] : this.contextKeys.get(key));
    const visible = (this.menus.get(menuId) ?? []).filter((item) => {
      try {
        return evaluateWhen(item.when, lookup);
      } catch (error) {
        this.logger.warn(`menu ${menuId}: hiding ${item.command}, its when clause does not parse`, error);
        return false;
      }
    });
    visible.sort(compareItems);

    const groups: MenuItem[][] = [];
    let previous: string | undefined;
    for (const item of visible) {
      const group = item.group || '';
      if (groups.length === 0 || group !== previous) {
        groups.push([]);
        previous = group;
      }
      groups[groups.length - 1]!.push(item);
    }
    return groups;
  }
}

function compareItems(a: MenuItem, b: MenuItem): number {
  const groupA = a.group || '';
  const groupB = b.group || '';
  if (groupA !== groupB) {
    if (!groupA) return 1;
    if (!groupB) return -1;
    if (groupA === 'navigation') return -1;
    if (groupB === 'navigation') return 1;
    const byName = groupA.localeCompare(groupB);
    if (byName !== 0) return byName;
  }
  const byOrder = (a.order ?? 0) - (b.order ?? 0);
  return byOrder !== 0 ? byOrder : a.title.localeCompare(b.title);
}
