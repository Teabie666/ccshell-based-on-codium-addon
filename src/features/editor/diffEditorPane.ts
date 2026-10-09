/**
 * A content pane tab with a Monaco diff editor: the original on the left (read-only), the
 * proposed text on the right, editable when its document is. For Claude's proposed edits,
 * Accept / Reject buttons run the extension's commands on this tab.
 */

import { DisposableStore } from '../../platform/lifecycle';
import type { DiffActionDto, DocumentSnapshot } from '../../platform/protocol';
import type { Dialogs } from '../../core/dialogs';
import type { EditorHost, EditorPane } from '../../core/editors';
import type { ExtensionHostConnection } from '../../core/extensionHost';
import { t } from './messages';
import type { MonacoApi } from './monaco';
import { editorFontOptions, selectionToDto } from './textEditorPane';
import type { ModelReference, TextModels } from './textModels';

type DiffEditor = ReturnType<MonacoApi['editor']['createDiffEditor']>;

export interface DiffInputData {
  readonly tabId: string;
  readonly original: DocumentSnapshot;
  readonly modified: DocumentSnapshot;
  readonly originalEditorId: string;
  readonly modifiedEditorId: string;
  readonly actions: readonly DiffActionDto[];
}

export class DiffEditorPane implements EditorPane {
  editor: DiffEditor;
  private readonly original: ModelReference;
  private readonly modified: ModelReference;
  private readonly disposables = new DisposableStore();
  /** What belongs to the current Monaco widget; recreated when the pane moves. */
  private readonly editorDisposables = new DisposableStore();
  private toolbar: HTMLElement | undefined;
  private body: HTMLElement;

  constructor(
    private readonly monaco: MonacoApi,
    container: HTMLElement,
    private readonly data: DiffInputData,
    private readonly host: EditorHost,
    private readonly models: TextModels,
    private readonly connection: ExtensionHostConnection,
    private readonly dialogs: Dialogs,
    private readonly label: string,
  ) {
    this.original = models.acquire(data.original);
    this.modified = models.acquire(data.modified);
    this.body = this.createLayout(container);
    this.editor = this.createEditor();
    const entry = this.modified.entry;
    host.setDirty(entry.isDirty);
    this.disposables.add(entry.onDidChangeDirty((dirty) => host.setDirty(dirty)));
    this.disposables.add(this.editorDisposables);
  }

  /** A new Monaco diff widget in `container` (e.g. another window's), same models. */
  relocate(container: HTMLElement): void {
    const viewState = this.editor.saveViewState();
    this.editorDisposables.clear();
    this.editor.dispose();
    this.toolbar?.remove();
    this.body.remove();
    this.body = this.createLayout(container);
    this.editor = this.createEditor();
    if (viewState) {
      this.editor.restoreViewState(viewState);
    }
  }

  private createLayout(container: HTMLElement): HTMLElement {
    container.classList.add('text-editor-container');
    if (this.data.actions.length > 0) {
      this.toolbar = this.createToolbar(container.ownerDocument, this.data.actions);
      container.appendChild(this.toolbar);
    }
    const body = container.ownerDocument.createElement('div');
    body.className = 'editor-body';
    container.appendChild(body);
    return body;
  }

  private createEditor(): DiffEditor {
    const editor = this.monaco.editor.createDiffEditor(this.body, {
      automaticLayout: true,
      ...editorFontOptions(),
      originalEditable: false,
      readOnly: this.modified.entry.readOnly,
      renderSideBySide: true,
      // A narrow content pane switches to the inline view, like VS Code does.
      useInlineViewWhenSpaceIsLimited: true,
      scrollBeyondLastLine: false,
      fixedOverflowWidgets: true,
    });
    editor.setModel({ original: this.original.entry.model, modified: this.modified.entry.model });
    const modifiedEditor = editor.getModifiedEditor();
    this.editorDisposables.add(
      modifiedEditor.onDidChangeCursorSelection(() => {
        this.connection.rpc?.notify('editor.didChangeSelection', {
          editorId: this.data.modifiedEditorId,
          selections: (modifiedEditor.getSelections() ?? []).map(selectionToDto),
        });
      }),
    );
    this.editorDisposables.add(modifiedEditor.onDidFocusEditorText(() => this.host.activate()));
    this.editorDisposables.add(editor.getOriginalEditor().onDidFocusEditorText(() => this.host.activate()));
    return editor;
  }

  /** The modified side takes input; both sides count as visible, like VS Code's diff editor. */
  get textEditorIds(): readonly string[] {
    return [this.data.modifiedEditorId, this.data.originalEditorId];
  }

  get modifiedUri(): string {
    return this.data.modified.uri;
  }

  layout(): void {
    this.editor.layout();
  }

  setVisible(): void {}

  focus(): void {
    this.editor.getModifiedEditor().focus();
  }

  /** Runs one of the diff's actions (Accept / Reject) on this tab. */
  runAction(kind: DiffActionDto['kind']): void {
    const action = this.data.actions.find((candidate) => candidate.kind === kind);
    const rpc = this.connection.rpc;
    if (!action || !rpc) {
      return;
    }
    // The extension's commands act on the active tab: make it this one first (same port, so in order).
    rpc.notify('tab.didActivate', { tabId: this.data.tabId });
    void this.connection.executeCommand(action.command);
  }

  async confirmClose(): Promise<boolean> {
    const entry = this.modified.entry;
    const own: unknown[] = [this.editor.getOriginalEditor(), this.editor.getModifiedEditor()];
    // Another tab still shows the document (e.g. "compare with saved"): its changes stay there.
    const sharedElsewhere = this.monaco.editor.getEditors().some((other) => !own.includes(other) && other.getModel() === entry.model);
    if (!entry.isDirty || sharedElsewhere) {
      return true;
    }
    const choice = await this.dialogs.showMessage({
      severity: 'warning',
      message: t('saveChangesQuestion', this.label),
      detail: t('saveChangesDetail'),
      modal: true,
      items: [t('save'), t('dontSave')],
    });
    if (choice === 0) {
      return this.models.save(entry.uri);
    }
    return choice === 1;
  }

  dispose(): void {
    this.disposables.dispose();
    this.editor.dispose();
    this.original.dispose();
    this.modified.dispose();
    this.connection.rpc?.notify('tab.didClose', { tabId: this.data.tabId });
  }

  private createToolbar(doc: Document, actions: readonly DiffActionDto[]): HTMLElement {
    const toolbar = doc.createElement('div');
    toolbar.className = 'diff-toolbar';
    const hint = doc.createElement('span');
    hint.className = 'diff-toolbar-hint';
    hint.textContent = t('proposedChanges');
    toolbar.appendChild(hint);
    for (const action of actions) {
      const button = doc.createElement('button');
      button.className = action.kind === 'accept' ? 'button' : 'button secondary';
      button.dataset.action = action.kind;
      button.textContent = action.kind === 'accept' ? t('accept') : t('reject');
      button.addEventListener('click', () => this.runAction(action.kind));
      toolbar.appendChild(button);
    }
    return toolbar;
  }
}
