/**
 * A Markdown document's tab: the rendered preview by default, the Monaco source a toggle
 * away. Both views share the document's text model, so the preview follows edits.
 */

import { Emitter } from '../../platform/event';
import { DisposableStore } from '../../platform/lifecycle';
import type { ILogger } from '../../platform/log';
import type { EditorHost, EditorInput, EditorPane } from '../../core/editors';
import type { TextEditorService } from '../editor';
import type { TextEditorPane } from '../editor/textEditorPane';
import { t } from './messages';

const RENDER_DELAY_MS = 150;

type Mode = 'preview' | 'source';

export interface LinkHandler {
  /** An http(s) or mailto link. */
  openExternal(url: string): void;
  /** A link to another file, resolved against the document's folder. */
  openFile(path: string): void;
}

/** GitHub-style heading anchors: lower case, punctuation dropped, spaces to dashes. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

let renderer: Promise<{ toHtml(markdown: string): string }> | undefined;

/** marked + DOMPurify, loaded with the first preview. */
function loadRenderer(): Promise<{ toHtml(markdown: string): string }> {
  renderer ??= Promise.all([import('marked'), import('dompurify')]).then(([{ marked }, { default: purify }]) => ({
    toHtml: (markdown: string) => purify.sanitize(marked.parse(markdown, { gfm: true, async: false })),
  }));
  return renderer;
}

export class MarkdownPane implements EditorPane {
  private mode: Mode = 'preview';
  private readonly source: TextEditorPane;
  private readonly preview: HTMLElement;
  private readonly sourceContainer: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly toolbar: HTMLElement;
  private readonly disposables = new DisposableStore();
  private readonly textEditorsEmitter = new Emitter<void>();
  readonly onDidChangeTextEditors = this.textEditorsEmitter.event;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private renderedVersion = -1;

  constructor(
    container: HTMLElement,
    private readonly input: EditorInput,
    host: EditorHost,
    private readonly editors: TextEditorService,
    private readonly links: LinkHandler,
    private readonly logger: ILogger,
  ) {
    container.classList.add('text-editor-container');
    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    this.toolbar = toolbar;
    const spacer = document.createElement('span');
    spacer.className = 'editor-toolbar-spacer';
    this.toggle = document.createElement('button');
    this.toggle.className = 'button secondary';
    this.toggle.addEventListener('click', () => this.setMode(this.mode === 'preview' ? 'source' : 'preview'));
    toolbar.append(spacer, this.toggle);

    this.preview = document.createElement('div');
    this.preview.className = 'markdown-preview';
    this.preview.tabIndex = 0;
    this.preview.addEventListener('click', (event) => this.onClick(event));
    this.sourceContainer = document.createElement('div');
    this.sourceContainer.className = 'editor-body';
    container.append(toolbar, this.preview, this.sourceContainer);

    this.source = editors.createPane(this.sourceContainer, input, host);
    const model = this.source.editor.getModel();
    if (model) {
      this.disposables.add(model.onDidChangeContent(() => this.scheduleRender()));
    }
    this.applyMode();
  }

  get textEditorIds(): readonly string[] {
    // Like VS Code's preview (a webview), the rendered view is no text editor.
    return this.mode === 'source' ? this.source.textEditorIds : [];
  }

  get isSource(): boolean {
    return this.mode === 'source';
  }

  setMode(mode: Mode): void {
    if (mode === this.mode) {
      return;
    }
    this.mode = mode;
    this.applyMode();
    this.focus();
    this.textEditorsEmitter.fire();
  }

  /** Re-renders the preview (e.g. for a new color theme of its code blocks). */
  refresh(): void {
    this.renderedVersion = -1;
    this.scheduleRender();
  }

  /** Moves the preview (plain DOM) and the source editor (a new Monaco widget) into `container`. */
  relocate(container: HTMLElement): void {
    container.classList.add('text-editor-container');
    container.append(this.toolbar, this.preview, this.sourceContainer);
    this.source.relocate(this.sourceContainer);
  }

  layout(): void {
    this.source.layout();
  }

  setVisible(): void {}

  focus(): void {
    if (this.mode === 'source') {
      this.source.focus();
    } else {
      this.preview.focus();
    }
  }

  confirmClose(): Promise<boolean> {
    return this.source.confirmClose();
  }

  dispose(): void {
    clearTimeout(this.renderTimer);
    this.disposables.dispose();
    this.textEditorsEmitter.dispose();
    this.source.dispose();
  }

  private applyMode(): void {
    const preview = this.mode === 'preview';
    this.preview.hidden = !preview;
    this.sourceContainer.hidden = preview;
    this.toggle.textContent = preview ? t('openSource') : t('openPreview');
    if (preview) {
      this.scheduleRender(0);
    } else {
      this.source.layout();
    }
  }

  private scheduleRender(delay = RENDER_DELAY_MS): void {
    if (this.mode !== 'preview') {
      return;
    }
    clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => void this.render().catch((error: unknown) => this.logger.error('rendering the preview failed', error)), delay);
  }

  private async render(): Promise<void> {
    const model = this.source.editor.getModel();
    if (!model || model.getVersionId() === this.renderedVersion) {
      return;
    }
    const version = model.getVersionId();
    const { toHtml } = await loadRenderer();
    const scroll = this.preview.scrollTop;
    this.preview.innerHTML = toHtml(model.getValue());
    this.renderedVersion = version;
    for (const heading of this.preview.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      heading.id ||= slugify(heading.textContent ?? '');
    }
    this.preview.scrollTop = scroll;
    await this.highlightCodeBlocks();
  }

  private async highlightCodeBlocks(): Promise<void> {
    const { toHtml } = await loadRenderer();
    for (const code of this.preview.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
      const language = /language-([\w#+.-]+)/.exec(code.className)?.[1];
      const pre = code.parentElement;
      if (!language || !pre) {
        continue;
      }
      const html = await this.editors.codeToHtml(code.textContent ?? '', language);
      if (html && pre.isConnected) {
        // Shiki escapes the code; sanitize anyway, it ends up in the shell's page.
        pre.outerHTML = toHtml(html);
      }
    }
  }

  private onClick(event: MouseEvent): void {
    const anchor = (event.target as Element | null)?.closest('a');
    const href = anchor?.getAttribute('href');
    if (!anchor || !href) {
      return;
    }
    event.preventDefault();
    if (href.startsWith('#')) {
      this.preview.querySelector(`#${CSS.escape(decodeURIComponent(href.slice(1)))}`)?.scrollIntoView();
    } else if (/^(https?|mailto):/i.test(href)) {
      this.links.openExternal(href);
    } else if (!/^[a-z][\w+.-]*:/i.test(href)) {
      const folder = (this.input.tooltip ?? '').replace(/[\\/][^\\/]*$/, '');
      this.links.openFile(`${folder}/${decodeURIComponent(href.split('#')[0]!)}`);
    }
  }
}
