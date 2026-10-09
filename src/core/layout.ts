/**
 * The window's regions:
 *
 *   titlebar: [left items][tabs][right items][native window controls]
 *   workbench: [sidebar | sash | main]
 *   overlays (toasts, quick input, dialogs)
 *
 * Sidebar visibility and width are per-user UI state kept in localStorage.
 */

import { Emitter, type Event } from '../platform/event';
import type { IDisposable } from '../platform/lifecycle';

const STORAGE_KEY = 'ccshell.layout.v1';
const SIDEBAR_MIN = 180;
const SIDEBAR_DEFAULT = 280;

interface LayoutState {
  sidebarVisible: boolean;
  sidebarWidth: number;
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`#${id} missing from index.html`);
  }
  return found;
}

export type TitleBarSide = 'left' | 'right';

export class Layout {
  readonly titleBarLeft = element('titlebar-left');
  readonly titleBarRight = element('titlebar-right');
  readonly tabs = element('tabs');
  readonly sidebar = element('sidebar');
  readonly main = element('main');
  readonly overlays = element('overlays');
  private readonly sash = element('sidebar-sash');
  private readonly state: LayoutState;
  private readonly sidebarEmitter = new Emitter<boolean>();
  readonly onDidChangeSidebarVisibility: Event<boolean> = this.sidebarEmitter.event;

  constructor() {
    this.state = loadState();
    this.applySidebar();
    this.installSash();
  }

  get sidebarVisible(): boolean {
    return this.state.sidebarVisible;
  }

  setSidebarVisible(visible: boolean): void {
    if (visible === this.state.sidebarVisible) {
      return;
    }
    this.state.sidebarVisible = visible;
    this.applySidebar();
    saveState(this.state);
    this.sidebarEmitter.fire(visible);
  }

  toggleSidebar(): void {
    this.setSidebarVisible(!this.state.sidebarVisible);
  }

  /** Adds an element to the title bar; lower `order` sits further left. */
  addTitleBarItem(side: TitleBarSide, item: HTMLElement, order = 0): IDisposable {
    const container = side === 'left' ? this.titleBarLeft : this.titleBarRight;
    item.dataset.order = String(order);
    const next = [...container.children].find((child) => Number((child as HTMLElement).dataset.order) > order);
    container.insertBefore(item, next ?? null);
    return { dispose: () => item.remove() };
  }

  private applySidebar(): void {
    this.sidebar.hidden = !this.state.sidebarVisible;
    this.sash.hidden = !this.state.sidebarVisible;
    this.sidebar.style.width = `${this.state.sidebarWidth}px`;
    document.body.classList.toggle('sidebar-visible', this.state.sidebarVisible);
  }

  private installSash(): void {
    this.sash.addEventListener('pointerdown', (start) => {
      start.preventDefault();
      this.sash.setPointerCapture(start.pointerId);
      // iframes swallow pointer events; disable them while dragging.
      document.body.classList.add('resizing');
      const initialWidth = this.state.sidebarWidth;
      const onMove = (move: PointerEvent): void => {
        const max = Math.max(SIDEBAR_MIN, window.innerWidth / 2);
        this.state.sidebarWidth = Math.round(Math.min(max, Math.max(SIDEBAR_MIN, initialWidth + move.clientX - start.clientX)));
        this.sidebar.style.width = `${this.state.sidebarWidth}px`;
      };
      const onUp = (): void => {
        document.body.classList.remove('resizing');
        this.sash.removeEventListener('pointermove', onMove);
        this.sash.removeEventListener('pointerup', onUp);
        saveState(this.state);
      };
      this.sash.addEventListener('pointermove', onMove);
      this.sash.addEventListener('pointerup', onUp);
    });
    this.sash.addEventListener('dblclick', () => {
      this.state.sidebarWidth = SIDEBAR_DEFAULT;
      this.applySidebar();
      saveState(this.state);
    });
  }
}

function loadState(): LayoutState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<LayoutState>;
    return {
      sidebarVisible: parsed.sidebarVisible ?? true,
      sidebarWidth: typeof parsed.sidebarWidth === 'number' ? Math.max(SIDEBAR_MIN, parsed.sidebarWidth) : SIDEBAR_DEFAULT,
    };
  } catch {
    return { sidebarVisible: true, sidebarWidth: SIDEBAR_DEFAULT };
  }
}

function saveState(state: LayoutState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable (e.g. a locked profile); layout just isn't remembered.
  }
}
