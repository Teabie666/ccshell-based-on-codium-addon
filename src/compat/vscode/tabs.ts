/**
 * `window.tabGroups`. vilaus has two editor groups: the conversation area (column One)
 * and the content pane (column Two). The extension inspects them to find its own panels
 * (TabInputWebview) and diff editors (TabInputTextDiff), and closes tabs through
 * `tabGroups.close`.
 */

import type * as vscode from 'vscode';
import { Emitter, type Event } from '../../platform/event';
import type { PanelArea } from '../../platform/protocol';
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
  readonly tabs: TabImpl[] = [];

  constructor(
    readonly viewColumn: ViewColumn,
    private readonly model: TabGroupsModel,
  ) {}

  get isActive(): boolean {
    return this.model.activeTabGroup === this;
  }

  get activeTab(): TabImpl | undefined {
    return this.tabs.find((tab) => tab.isActive);
  }
}

export class TabGroupsModel {
  private readonly main = new TabGroupImpl(ViewColumn.One, this);
  private readonly side = new TabGroupImpl(ViewColumn.Two, this);
  private activeGroup: TabGroupImpl = this.main;
  private readonly tabsEmitter = new Emitter<vscode.TabChangeEvent>();
  private readonly groupsEmitter = new Emitter<vscode.TabGroupChangeEvent>();
  readonly onDidChangeTabs: Event<vscode.TabChangeEvent> = this.tabsEmitter.event;
  readonly onDidChangeTabGroups: Event<vscode.TabGroupChangeEvent> = this.groupsEmitter.event;

  /** Like VS Code, a group exists only while it has tabs; the first group always exists. */
  get all(): readonly TabGroupImpl[] {
    return this.side.tabs.length > 0 ? [this.main, this.side] : [this.main];
  }

  get activeTabGroup(): TabGroupImpl {
    return this.activeGroup;
  }

  groupFor(area: PanelArea): TabGroupImpl {
    return area === 'side' ? this.side : this.main;
  }

  add(area: PanelArea, label: string, input: unknown, close: () => void | Promise<void>): TabImpl {
    const tab = new TabImpl(label, this.groupFor(area), input, close);
    tab.group.tabs.push(tab);
    this.fire({ opened: [tab], closed: [], changed: [] });
    return tab;
  }

  remove(tab: TabImpl): void {
    const tabs = tab.group.tabs;
    const index = tabs.indexOf(tab);
    if (index < 0) {
      return;
    }
    tabs.splice(index, 1);
    this.fire({ opened: [], closed: [tab], changed: [] });
    if (tab.group === this.side && tabs.length === 0 && this.activeGroup === this.side) {
      this.setActiveGroup(this.main);
    }
  }

  /** Makes `tab` the active tab of its group, and its group the active group. */
  setActive(tab: TabImpl): void {
    const changed: TabImpl[] = [];
    for (const candidate of tab.group.tabs) {
      const active = candidate === tab;
      if (candidate.isActive !== active) {
        candidate.isActive = active;
        changed.push(candidate);
      }
    }
    if (changed.length > 0) {
      this.fire({ opened: [], closed: [], changed });
    }
    this.setActiveGroup(tab.group);
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

  private setActiveGroup(group: TabGroupImpl): void {
    if (this.activeGroup === group) {
      return;
    }
    const previous = this.activeGroup;
    this.activeGroup = group;
    this.groupsEmitter.fire({ opened: [], closed: [], changed: [previous, group] } as unknown as vscode.TabGroupChangeEvent);
  }

  private fire(event: { opened: TabImpl[]; closed: TabImpl[]; changed: TabImpl[] }): void {
    this.tabsEmitter.fire(event as unknown as vscode.TabChangeEvent);
  }
}

function collectTabs(target: TabImpl | readonly TabImpl[] | TabGroupImpl | readonly TabGroupImpl[]): TabImpl[] {
  const items = Array.isArray(target) ? target : [target];
  return items.flatMap((item: TabImpl | TabGroupImpl) => (item instanceof TabGroupImpl ? [...item.tabs] : [item]));
}
