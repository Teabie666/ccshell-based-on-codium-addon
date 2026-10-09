/**
 * The content pane: a tab strip and one editor per tab, right of the conversation. Which
 * editor shows a tab comes from the core editor registry; this class only manages tabs:
 * opening (with VS Code's preview tabs), activating, dirty markers and closing.
 */

import { Emitter, type Event } from '../../platform/event';
import type { ILogger } from '../../platform/log';
import type { EditorHost, EditorInput, EditorPane, EditorRegistry } from '../../core/editors';
import type { Layout } from '../../core/layout';
import { t } from './messages';

export interface OpenOptions {
  /** Keep focus where it is (the pane still opens and the tab still activates). */
  readonly preserveFocus?: boolean;
  /** Replace the current preview tab instead of adding one, until edited or pinned. */
  readonly preview?: boolean;
  /** Activate the tab even when it is already open but another tab is active. Default true. */
  readonly activate?: boolean;
}

export interface ContentTab {
  readonly input: EditorInput;
  readonly pane: EditorPane;
  readonly isPreview: boolean;
  readonly isDirty: boolean;
}

interface TabEntry extends ContentTab {
  readonly element: HTMLElement;
  readonly container: HTMLElement;
  isPreview: boolean;
  isDirty: boolean;
  closing: boolean;
}

export class ContentPane {
  private readonly strip: HTMLElement;
  private readonly body: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly entries = new Map<string, TabEntry>();
  /** Most recently active first; picks the next tab when one closes. */
  private history: string[] = [];
  private activeId: string | undefined;
  private readonly activeEmitter = new Emitter<ContentTab | undefined>();
  readonly onDidChangeActive: Event<ContentTab | undefined> = this.activeEmitter.event;
  private readonly closeEmitter = new Emitter<ContentTab>();
  readonly onDidClose: Event<ContentTab> = this.closeEmitter.event;
  private readonly focusEmitter = new Emitter<boolean>();
  readonly onDidChangeFocus: Event<boolean> = this.focusEmitter.event;
  private focused = false;

  constructor(
    private readonly layout: Layout,
    private readonly editors: EditorRegistry,
    private readonly logger: ILogger,
  ) {
    const root = layout.contentPane;
    this.strip = document.createElement('div');
    this.strip.className = 'content-tabs';
    this.strip.setAttribute('role', 'tablist');
    this.strip.setAttribute('aria-label', t('openEditors'));
    this.body = document.createElement('div');
    this.body.className = 'content-body';
    this.empty = createEmptyState();
    this.body.appendChild(this.empty);
    root.append(this.strip, this.body);

    // Focus inside the pane, including into a webview iframe (the iframe element gets focus).
    const updateFocus = (): void => {
      const focused = root.contains(document.activeElement);
      if (focused !== this.focused) {
        this.focused = focused;
        this.focusEmitter.fire(focused);
      }
    };
    root.addEventListener('focusin', updateFocus);
    root.addEventListener('focusout', () => setTimeout(updateFocus));
    window.addEventListener('blur', () => setTimeout(updateFocus));
    layout.onDidResizeContentPane(() => this.active?.pane.layout());
    layout.onDidChangeContentPaneVisibility((visible) => {
      this.active?.pane.setVisible(visible);
      if (visible) {
        this.active?.pane.layout();
      }
    });
  }

  get active(): ContentTab | undefined {
    return this.activeId ? this.entries.get(this.activeId) : undefined;
  }

  get tabs(): readonly ContentTab[] {
    return this.ordered();
  }

  get hasFocus(): boolean {
    return this.focused;
  }

  get(inputId: string): ContentTab | undefined {
    return this.entries.get(inputId);
  }

  /** Opens `input` in a tab (or activates its existing tab) and shows the pane. */
  open(input: EditorInput, options: OpenOptions = {}): ContentTab | undefined {
    const existing = this.entries.get(input.id);
    if (existing) {
      if (options.preview === false) {
        this.pin(existing);
      }
      if (options.activate !== false || this.activeId === undefined) {
        this.layout.setContentPaneVisible(true);
        this.activate(existing, !options.preserveFocus);
      }
      return existing;
    }
    const provider = this.editors.resolve(input);
    if (!provider) {
      this.logger.warn(`no editor for ${input.typeId} input ${input.id}`);
      return undefined;
    }
    if (options.preview) {
      const replaced = [...this.entries.values()].find((entry) => entry.isPreview && !entry.isDirty);
      if (replaced) {
        this.remove(replaced);
      }
    }
    const container = document.createElement('div');
    container.className = 'content-editor';
    container.hidden = true;
    this.body.appendChild(container);
    const element = this.createTabElement(input);
    // Editors may call their host only once the tab exists.
    let entry: TabEntry | undefined;
    const host: EditorHost = {
      setDirty: (dirty) => entry && this.setDirty(entry, dirty),
      pin: () => entry && this.pin(entry),
      close: () => void this.close(input.id),
      activate: () => entry && this.entries.has(input.id) && this.activate(entry, false),
    };
    let pane: EditorPane;
    try {
      pane = provider.create(container, input, host);
    } catch (error) {
      this.logger.error(`editor ${provider.id} failed to open ${input.id}`, error);
      container.remove();
      return undefined;
    }
    entry = { input, pane, element, container, isPreview: options.preview === true, isDirty: false, closing: false };
    element.classList.toggle('preview', entry.isPreview);
    // A new tab goes right of the active one, like VS Code.
    const activeElement = this.activeId ? this.entries.get(this.activeId)?.element : undefined;
    this.strip.insertBefore(element, activeElement?.nextSibling ?? null);
    this.entries.set(input.id, entry);
    this.empty.hidden = true;
    this.layout.setContentPaneVisible(true);
    this.activate(entry, !options.preserveFocus);
    return entry;
  }

  /** Asks the tab's editor (unsaved changes...) and closes the tab. Resolves to whether it closed. */
  async close(inputId: string | undefined = this.activeId): Promise<boolean> {
    const entry = inputId ? this.entries.get(inputId) : undefined;
    if (!entry || entry.closing) {
      return false;
    }
    entry.closing = true;
    let proceed = true;
    try {
      proceed = (await entry.pane.confirmClose?.()) ?? true;
    } catch (error) {
      this.logger.error(`closing ${inputId} failed`, error);
    }
    entry.closing = false;
    if (proceed && this.entries.get(entry.input.id) === entry) {
      this.remove(entry);
    }
    return proceed;
  }

  /** Closes without asking (the owner already decided, e.g. the extension closed it). */
  remove(entryOrId: TabEntry | string): void {
    const entry = typeof entryOrId === 'string' ? this.entries.get(entryOrId) : entryOrId;
    if (!entry || this.entries.get(entry.input.id) !== entry) {
      return;
    }
    const wasActive = this.activeId === entry.input.id;
    const hadFocus = this.focused;
    this.entries.delete(entry.input.id);
    this.history = this.history.filter((id) => id !== entry.input.id);
    entry.element.remove();
    try {
      entry.pane.dispose();
    } catch (error) {
      this.logger.error(`disposing the editor of ${entry.input.id} failed`, error);
    }
    entry.container.remove();
    if (wasActive) {
      this.activeId = undefined;
      const next = this.history[0] ? this.entries.get(this.history[0]) : undefined;
      if (next) {
        this.activate(next, hadFocus);
      } else {
        this.activeEmitter.fire(undefined);
      }
    }
    this.closeEmitter.fire(entry);
    if (this.entries.size === 0) {
      this.empty.hidden = false;
      // The pane shows while it has something to show.
      this.layout.setContentPaneVisible(false);
    }
  }

  /** Activates the tab `offset` positions away from the active one, wrapping around. */
  cycle(offset: number): void {
    const ordered = this.ordered();
    if (ordered.length === 0) {
      return;
    }
    const index = ordered.findIndex((entry) => entry.input.id === this.activeId);
    this.activate(ordered[(index + offset + ordered.length) % ordered.length]!, true);
  }

  focusActive(): void {
    this.active?.pane.focus();
  }

  /** A tab's title changed (e.g. a webview panel was renamed). */
  setLabel(inputId: string, label: string): void {
    const entry = this.entries.get(inputId);
    const element = entry?.element.querySelector('.tab-label');
    if (entry && element) {
      element.textContent = label;
      entry.element.title = label;
    }
  }

  private ordered(): TabEntry[] {
    return [...this.strip.children].flatMap((element) => {
      const entry = this.entries.get((element as HTMLElement).dataset.inputId ?? '');
      return entry ? [entry] : [];
    });
  }

  private activate(entry: TabEntry, focus: boolean): void {
    const previous = this.activeId ? this.entries.get(this.activeId) : undefined;
    const changed = previous !== entry;
    if (previous && changed) {
      previous.element.classList.remove('active');
      previous.element.setAttribute('aria-selected', 'false');
      previous.container.hidden = true;
      previous.pane.setVisible(false);
    }
    this.activeId = entry.input.id;
    this.history = [entry.input.id, ...this.history.filter((id) => id !== entry.input.id)];
    entry.element.classList.add('active');
    entry.element.setAttribute('aria-selected', 'true');
    entry.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (changed) {
      entry.container.hidden = false;
      entry.pane.setVisible(this.layout.contentPaneVisible);
      entry.pane.layout();
    }
    if (focus) {
      entry.pane.focus();
    }
    if (changed) {
      this.activeEmitter.fire(entry);
    }
  }

  private pin(entry: TabEntry): void {
    if (entry.isPreview) {
      entry.isPreview = false;
      entry.element.classList.remove('preview');
    }
  }

  private setDirty(entry: TabEntry, dirty: boolean): void {
    if (entry.isDirty === dirty) {
      return;
    }
    entry.isDirty = dirty;
    entry.element.classList.toggle('dirty', dirty);
    if (dirty) {
      this.pin(entry);
    }
  }

  private createTabElement(input: EditorInput): HTMLElement {
    const tab = document.createElement('div');
    tab.className = 'tab content-tab';
    tab.setAttribute('role', 'tab');
    tab.dataset.inputId = input.id;
    tab.title = input.tooltip ?? input.label;
    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = input.label;
    tab.appendChild(label);
    if (input.description) {
      const description = document.createElement('span');
      description.className = 'tab-description';
      description.textContent = input.description;
      tab.appendChild(description);
    }
    const close = document.createElement('button');
    close.className = 'tab-close icon-button';
    close.title = t('closeEditor');
    close.setAttribute('aria-label', t('closeEditor'));
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.close(input.id);
    });
    tab.appendChild(close);
    tab.addEventListener('mousedown', (event) => {
      const entry = this.entries.get(input.id);
      if (event.button === 0 && entry) {
        this.activate(entry, true);
      }
    });
    tab.addEventListener('dblclick', () => {
      const entry = this.entries.get(input.id);
      if (entry) {
        this.pin(entry);
      }
    });
    tab.addEventListener('auxclick', (event) => {
      if (event.button === 1) {
        void this.close(input.id);
      }
    });
    return tab;
  }
}

function createEmptyState(): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  const title = document.createElement('div');
  title.className = 'empty-state-title';
  title.textContent = t('noOpenEditors');
  const row = document.createElement('div');
  row.className = 'empty-state-row';
  const label = document.createElement('span');
  label.textContent = t('openFileHint');
  const hint = document.createElement('kbd');
  hint.textContent = 'Ctrl+P';
  row.append(label, hint);
  empty.append(title, row);
  return empty;
}
