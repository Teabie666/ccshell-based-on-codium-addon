/**
 * The settings editor, after VS Code's: a search box, a table of contents of the sections,
 * and each setting with a control for its type (checkbox, dropdown, text or number field;
 * values too complex for a control link to settings.json). Modified settings are marked
 * and can be reset. Changes are written at once; settings.json edited elsewhere shows here.
 */

import { DisposableStore } from '../../platform/lifecycle';
import type { ILogger } from '../../platform/log';
import type { EditorPane } from '../../core/editors';
import type { SettingDefinition, SettingsService } from '../../core/settings';
import { t } from './messages';
import {
  controlKind,
  deprecationOf,
  descriptionOf,
  groupBySection,
  matchesQuery,
  parseNumber,
  sameValue,
  settingTitle,
} from './settingItems';

/** Typing in a text field writes after this pause. */
const WRITE_DELAY_MS = 500;

export interface SettingsEditorContext {
  readonly settings: SettingsService;
  /** Opens settings.json, showing `key` (added with its default value if missing). */
  readonly openJson: (key?: string) => void;
  /** Opens the read-only default settings. */
  readonly openDefaults: () => void;
  readonly logger: ILogger;
}

/** One setting's row. */
class SettingRow {
  readonly element: HTMLElement;
  private readonly refreshControl: () => void;

  constructor(
    private readonly doc: Document,
    readonly definition: SettingDefinition,
    private readonly context: SettingsEditorContext,
  ) {
    const { key, schema } = definition;
    const element = doc.createElement('div');
    element.className = 'setting-item';
    element.dataset.key = key;
    this.element = element;

    const title = doc.createElement('div');
    title.className = 'setting-title';
    const { category, name } = settingTitle(key);
    if (category) {
      const categoryLabel = doc.createElement('span');
      categoryLabel.className = 'setting-category';
      categoryLabel.textContent = `${category}: `;
      title.appendChild(categoryLabel);
    }
    const nameLabel = doc.createElement('span');
    nameLabel.className = 'setting-name';
    nameLabel.textContent = name;
    title.appendChild(nameLabel);
    const reset = doc.createElement('button');
    reset.className = 'icon-button setting-reset icon-discard';
    reset.title = t('resetSetting');
    reset.setAttribute('aria-label', t('resetSetting'));
    reset.addEventListener('click', () => this.write(undefined));
    title.appendChild(reset);
    element.appendChild(title);

    const deprecation = deprecationOf(schema);
    if (deprecation) {
      const warning = doc.createElement('div');
      warning.className = 'setting-deprecated';
      warning.textContent = `${t('deprecated')}: ${deprecation}`;
      element.appendChild(warning);
    }

    const description = descriptionOf(schema);
    const kind = controlKind(schema);
    if (kind !== 'boolean' && description) {
      const text = doc.createElement('div');
      text.className = 'setting-description';
      text.textContent = description;
      element.appendChild(text);
    }
    this.refreshControl = this.createControl(kind, description);
    this.refresh();
  }

  /** The value or the modified state changed (here or in settings.json). */
  refresh(): void {
    const modified = this.context.settings.isSet(this.definition.key);
    this.element.classList.toggle('modified', modified);
    this.refreshControl();
  }

  private get value(): unknown {
    return this.context.settings.get<unknown>(this.definition.key, undefined);
  }

  /** Writes a value; one equal to the default removes the setting instead, keeping settings.json short. */
  private write(value: unknown): void {
    const { key, schema } = this.definition;
    const stored = value === undefined || (schema.default !== undefined && sameValue(value, schema.default)) ? undefined : value;
    this.context.settings.update(key, stored).catch((error: unknown) => this.context.logger.error(`writing ${key} failed`, error));
  }

  private createControl(kind: ReturnType<typeof controlKind>, description: string): () => void {
    const { doc } = this;
    const { key, schema } = this.definition;
    switch (kind) {
      case 'boolean': {
        const row = doc.createElement('label');
        row.className = 'setting-checkbox-row';
        const box = doc.createElement('input');
        box.type = 'checkbox';
        box.className = 'setting-checkbox';
        box.addEventListener('change', () => this.write(box.checked));
        const text = doc.createElement('span');
        text.className = 'setting-description';
        text.textContent = description;
        row.append(box, text);
        this.element.appendChild(row);
        return () => {
          box.checked = this.value === true;
        };
      }
      case 'enum': {
        const values = schema.enum ?? [];
        const select = doc.createElement('select');
        select.className = 'setting-select';
        values.forEach((value, index) => {
          const option = doc.createElement('option');
          option.value = String(index);
          option.textContent = schema.enumItemLabels?.[index] ?? String(value);
          select.appendChild(option);
        });
        const help = doc.createElement('div');
        help.className = 'setting-enum-description';
        const describe = (): void => {
          const index = Number(select.value);
          const text = schema.markdownEnumDescriptions?.[index] ?? schema.enumDescriptions?.[index];
          help.textContent = text ?? '';
          help.hidden = !text;
        };
        select.addEventListener('change', () => {
          describe();
          this.write(values[Number(select.value)]);
        });
        this.element.append(select, help);
        return () => {
          const index = values.findIndex((value) => sameValue(value, this.value));
          select.value = index >= 0 ? String(index) : '';
          describe();
        };
      }
      case 'string':
      case 'number': {
        const input = doc.createElement('input');
        input.type = 'text';
        input.className = 'setting-input';
        input.spellcheck = false;
        if (kind === 'number') {
          input.inputMode = 'decimal';
        }
        const validation = doc.createElement('div');
        validation.className = 'setting-validation';
        validation.hidden = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const commit = (): void => {
          clearTimeout(timer);
          if (kind === 'string') {
            this.write(input.value);
            return;
          }
          const parsed = parseNumber(schema, input.value);
          const error = 'error' in parsed ? parsed.error : undefined;
          input.classList.toggle('invalid', error !== undefined);
          validation.hidden = error === undefined;
          if (error) {
            validation.textContent = numberError(error, schema.minimum, schema.maximum);
          } else if ('value' in parsed) {
            this.write(parsed.value);
          }
        };
        input.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(commit, WRITE_DELAY_MS);
        });
        input.addEventListener('change', commit);
        this.element.append(input, validation);
        return () => {
          // Never under the user's cursor: their typing wins until it is written.
          if (doc.activeElement !== input) {
            const value = this.value;
            input.value = value === undefined || value === null ? '' : String(value);
            input.classList.remove('invalid');
            validation.hidden = true;
          }
        };
      }
      default: {
        const link = doc.createElement('a');
        link.className = 'setting-edit-json';
        link.href = '#';
        link.textContent = t('editInJson');
        link.addEventListener('click', (event) => {
          event.preventDefault();
          this.context.openJson(key);
        });
        this.element.appendChild(link);
        return () => {};
      }
    }
  }
}

function numberError(error: 'notNumber' | 'tooSmall' | 'tooLarge' | 'notInteger', minimum?: number, maximum?: number): string {
  switch (error) {
    case 'tooSmall':
      return t('tooSmall', String(minimum));
    case 'tooLarge':
      return t('tooLarge', String(maximum));
    case 'notInteger':
      return t('notInteger');
    default:
      return t('notNumber');
  }
}

export class SettingsEditorPane implements EditorPane {
  private readonly root: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly toc: HTMLElement;
  private readonly list: HTMLElement;
  private readonly rows = new Map<string, SettingRow>();
  private readonly disposables = new DisposableStore();
  private renderScheduled = false;

  constructor(
    container: HTMLElement,
    private readonly context: SettingsEditorContext,
  ) {
    const doc = container.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'settings-editor';

    const header = doc.createElement('div');
    header.className = 'settings-header';
    this.search = doc.createElement('input');
    this.search.type = 'search';
    this.search.className = 'settings-search';
    this.search.placeholder = t('searchPlaceholder');
    this.search.setAttribute('aria-label', t('searchPlaceholder'));
    this.search.addEventListener('input', () => this.applyFilter());
    this.count = doc.createElement('span');
    this.count.className = 'settings-count';
    const openJson = doc.createElement('button');
    openJson.className = 'button secondary settings-open-json';
    openJson.textContent = t('openJson');
    openJson.addEventListener('click', () => context.openJson());
    const openDefaults = doc.createElement('button');
    openDefaults.className = 'button secondary settings-open-defaults';
    openDefaults.textContent = t('defaultSettingsButton');
    openDefaults.addEventListener('click', () => context.openDefaults());
    header.append(this.search, this.count, openJson, openDefaults);

    const body = doc.createElement('div');
    body.className = 'settings-body';
    this.toc = doc.createElement('nav');
    this.toc.className = 'settings-toc';
    this.toc.setAttribute('aria-label', t('sections'));
    this.list = doc.createElement('div');
    this.list.className = 'settings-list';
    body.append(this.toc, this.list);
    this.root.append(header, body);
    container.appendChild(this.root);

    this.render();
    this.disposables.add(context.settings.onDidChangeDefinitions(() => this.scheduleRender()));
    this.disposables.add(context.settings.onDidChange((keys) => keys.forEach((key) => this.rows.get(key)?.refresh())));
  }

  layout(): void {}

  setVisible(): void {}

  focus(): void {
    this.search.focus();
  }

  relocate(container: HTMLElement): void {
    container.appendChild(this.root);
  }

  dispose(): void {
    this.disposables.dispose();
    this.root.remove();
  }

  private scheduleRender(): void {
    if (this.renderScheduled) {
      return;
    }
    this.renderScheduled = true;
    // Modules register in bursts (the extension's settings arrive together).
    queueMicrotask(() => {
      this.renderScheduled = false;
      this.render();
    });
  }

  private render(): void {
    const doc = this.root.ownerDocument;
    const scroll = this.list.scrollTop;
    this.rows.clear();
    this.toc.replaceChildren();
    this.list.replaceChildren();
    const visible = this.context.settings.definitions.filter((definition) => !definition.hidden);
    for (const { section, settings } of groupBySection(visible)) {
      const group = doc.createElement('section');
      group.className = 'settings-section';
      const heading = doc.createElement('h2');
      heading.className = 'settings-section-title';
      heading.textContent = section;
      group.appendChild(heading);
      for (const definition of settings) {
        const row = new SettingRow(doc, definition, this.context);
        this.rows.set(definition.key, row);
        group.appendChild(row.element);
      }
      this.list.appendChild(group);

      const entry = doc.createElement('button');
      entry.className = 'settings-toc-item';
      entry.textContent = section;
      entry.addEventListener('click', () => heading.scrollIntoView({ block: 'start' }));
      this.toc.appendChild(entry);
    }
    this.applyFilter();
    this.list.scrollTop = scroll;
  }

  private applyFilter(): void {
    const query = this.search.value;
    let shown = 0;
    const sections = [...this.list.children] as HTMLElement[];
    const entries = [...this.toc.children] as HTMLElement[];
    sections.forEach((section, index) => {
      let any = false;
      for (const element of section.querySelectorAll<HTMLElement>('.setting-item')) {
        const row = this.rows.get(element.dataset.key ?? '');
        const match = row ? matchesQuery(row.definition, query) : false;
        element.hidden = !match;
        any ||= match;
        shown += match ? 1 : 0;
      }
      section.hidden = !any;
      const entry = entries[index];
      if (entry) {
        entry.hidden = !any;
      }
    });
    this.count.textContent = query.trim() ? (shown > 0 ? t('settingsFound', shown) : t('noSettingsFound')) : '';
  }
}
