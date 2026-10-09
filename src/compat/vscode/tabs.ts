/**
 * `window.tabGroups`. ccshell has a single editor group; the extension inspects it to
 * find its own panels (TabInputWebview) and diff editors (TabInputTextDiff), and closes
 * tabs through `tabGroups.close`.
 */

import type * as vscode from 'vscode';
import { Emitter, type Event } from '../../platform/event';
import { ViewColumn } from './types';

export class TabImpl {
  isActive = false;
  readonly isDirty = false;
  readonly isPinned = false;
  readonly isPreview = false;

  constructor(
    public label: string,
    readonly group: TabGroupImpl,
    readonly input: unknown,
    /** What closing this tab means (dispose the panel, cancel the diff...). */
    readonly close: () => void | Promise<void>,
  ) {}
}

export class TabGroupImpl {
  readonly viewColumn = ViewColumn.One;
  readonly isActive = true;
  readonly tabs: TabImpl[] = [];

  get activeTab(): TabImpl | undefined {
    return this.tabs.find((tab) => tab.isActive);
  }
}

export class TabGroupsModel {
  private readonly group = new TabGroupImpl();
  private readonly tabsEmitter = new Emitter<vscode.TabChangeEvent>();
  private readonly groupsEmitter = new Emitter<vscode.TabGroupChangeEvent>();
  readonly onDidChangeTabs: Event<vscode.TabChangeEvent> = this.tabsEmitter.event;
  readonly onDidChangeTabGroups: Event<vscode.TabGroupChangeEvent> = this.groupsEmitter.event;

  get all(): readonly TabGroupImpl[] {
    return [this.group];
  }

  get activeTabGroup(): TabGroupImpl {
    return this.group;
  }

  add(label: string, input: unknown, close: () => void | Promise<void>): TabImpl {
    const tab = new TabImpl(label, this.group, input, close);
    this.group.tabs.push(tab);
    this.fire({ opened: [tab], closed: [], changed: [] });
    return tab;
  }

  remove(tab: TabImpl): void {
    const index = this.group.tabs.indexOf(tab);
    if (index < 0) {
      return;
    }
    this.group.tabs.splice(index, 1);
    this.fire({ opened: [], closed: [tab], changed: [] });
  }

  setActive(tab: TabImpl | undefined): void {
    const changed: TabImpl[] = [];
    for (const candidate of this.group.tabs) {
      const active = candidate === tab;
      if (candidate.isActive !== active) {
        candidate.isActive = active;
        changed.push(candidate);
      }
    }
    if (changed.length > 0) {
      this.fire({ opened: [], closed: [], changed });
    }
  }

  setLabel(tab: TabImpl, label: string): void {
    if (tab.label !== label) {
      tab.label = label;
      this.fire({ opened: [], closed: [], changed: [tab] });
    }
  }

  async close(target: TabImpl | readonly TabImpl[] | TabGroupImpl | readonly TabGroupImpl[]): Promise<boolean> {
    const tabs = collectTabs(target);
    for (const tab of tabs) {
      await tab.close();
    }
    return true;
  }

  private fire(event: { opened: TabImpl[]; closed: TabImpl[]; changed: TabImpl[] }): void {
    this.tabsEmitter.fire(event as unknown as vscode.TabChangeEvent);
  }
}

function collectTabs(target: TabImpl | readonly TabImpl[] | TabGroupImpl | readonly TabGroupImpl[]): TabImpl[] {
  const items = Array.isArray(target) ? target : [target];
  return items.flatMap((item: TabImpl | TabGroupImpl) => (item instanceof TabGroupImpl ? [...item.tabs] : [item]));
}
