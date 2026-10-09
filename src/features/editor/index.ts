/**
 * Text editors in the content pane: Monaco with Shiki highlighting, on documents the
 * extension host shares (`showTextDocument`, quick open...). Loads Monaco on first use.
 * Offers ITextEditors to modules that open documents themselves.
 */

import type { EditorHost, EditorInput } from '../../core/editors';
import { CommandCategory } from '../../core/messages';
import type { ExtensionHostConnection } from '../../core/extensionHost';
import type { Layout } from '../../core/layout';
import type { ShellModule } from '../../core/module';
import {
  ICommands,
  IContextKeys,
  IDialogs,
  IEditors,
  IExtensionHost,
  IKeybindings,
  ILayout,
  IThemes,
} from '../../core/serviceIds';
import { createServiceId } from '../../core/services';
import type { ThemeService } from '../../core/themes';
import type { Dialogs } from '../../core/dialogs';
import { DisposableStore } from '../../platform/lifecycle';
import type { ILogger } from '../../platform/log';
import { getUiLanguage } from '../../platform/nls';
import { SAVED_FILE_SCHEME, type ShowDiffEditorParams, type ShowTextEditorParams } from '../../platform/protocol';
import { URI } from 'vscode-uri';
import { IContentPane } from '../contentPane';
import type { ContentPane } from '../contentPane/contentPane';
import { DiffEditorPane, type DiffInputData } from './diffEditorPane';
import { Highlighting } from './highlighting';
import { t } from './messages';
import { loadMonaco, type MonacoApi } from './monaco';
import { TextEditorPane, editorFontOptions, type TextInputData } from './textEditorPane';
import { basename, shortDiffTitle } from './titles';
import { TextModels } from './textModels';

/** The input type of documents shown in a text editor (other modules may claim some, e.g. Markdown). */
export const TEXT_INPUT = 'text';
const DIFF_INPUT = 'diff';

/** Content pane input id of an extension host tab (text or diff). */
function tabInputId(tabId: string): string {
  return `tab:${tabId}`;
}


export class TextEditorService {
  private loaded: Promise<{ monaco: MonacoApi; models: TextModels; highlighting: Highlighting }> | undefined;
  private monaco: MonacoApi | undefined;
  private models: TextModels | undefined;
  /** Text editor panes by the editor id the extension host assigned. */
  private readonly panes = new Map<string, TextEditorPane>();
  private readonly diffPanes = new Set<DiffEditorPane>();

  constructor(
    private readonly connection: ExtensionHostConnection,
    private readonly contentPane: ContentPane,
    private readonly themes: ThemeService,
    private readonly dialogs: Dialogs,
    private readonly logger: ILogger,
  ) {}

  /** Loads Monaco and the highlighter (once). Editors can only be created after this. */
  ready(): Promise<{ monaco: MonacoApi; models: TextModels; highlighting: Highlighting }> {
    this.loaded ??= (async () => {
      const started = performance.now();
      const monaco = await loadMonaco(getUiLanguage());
      const highlighting = new Highlighting(monaco, this.logger.child('highlighting'));
      await highlighting.setTheme(this.themes.current);
      const models = new TextModels(monaco, highlighting, this.connection, this.logger.child('models'));
      this.monaco = monaco;
      this.models = models;
      this.logger.info(`editor loaded in ${Math.round(performance.now() - started)} ms`);
      return { monaco, models, highlighting };
    })();
    return this.loaded;
  }

  get modelService(): TextModels | undefined {
    return this.models;
  }

  /** Highlights a code block as HTML in the current theme (undefined: show it plain). */
  async codeToHtml(code: string, language: string): Promise<string | undefined> {
    const { highlighting } = await this.ready();
    return highlighting.codeToHtml(code, language);
  }

  pane(editorId: string): TextEditorPane | undefined {
    return this.panes.get(editorId);
  }

  /** The text editor commands act on (a floating tab's when its window has focus). */
  get activePane(): TextEditorPane | undefined {
    const pane = this.contentPane.current?.pane;
    return pane instanceof TextEditorPane ? pane : undefined;
  }

  get activeDiff(): DiffEditorPane | undefined {
    const pane = this.contentPane.current?.pane;
    return pane instanceof DiffEditorPane ? pane : undefined;
  }

  /** The document Ctrl+S saves: the active text editor's, or the right side of the active diff. */
  get activeDocument(): string | undefined {
    return this.activePane?.uri ?? this.activeDiff?.modifiedUri;
  }

  /** The extension host's `editor.showDiff` (the `vscode.diff` command). */
  async showDiff(params: ShowDiffEditorParams): Promise<void> {
    await this.ready();
    const data: DiffInputData = {
      tabId: params.tabId,
      original: params.original,
      modified: params.modified,
      originalEditorId: params.originalEditorId,
      modifiedEditorId: params.modifiedEditorId,
      actions: params.actions,
    };
    this.contentPane.open(
      {
        id: tabInputId(params.tabId),
        typeId: DIFF_INPUT,
        label: shortDiffTitle(params.title, [params.original.path, params.modified.path]),
        tooltip: `${params.title}\n${params.original.path} ↔ ${params.modified.path}`,
        resource: params.modified.uri,
        languageId: params.modified.languageId,
        data,
      },
      { preserveFocus: params.preserveFocus },
    );
  }

  createDiffPane(container: HTMLElement, input: EditorInput, host: EditorHost): DiffEditorPane {
    if (!this.monaco || !this.models) {
      throw new Error('diff editors are not loaded yet; they open through the extension host');
    }
    const pane = new DiffEditorPane(
      this.monaco,
      container,
      input.data as DiffInputData,
      host,
      this.models,
      this.connection,
      this.dialogs,
      input.label,
    );
    this.diffPanes.add(pane);
    const dispose = pane.dispose.bind(pane);
    pane.dispose = () => {
      this.diffPanes.delete(pane);
      dispose();
    };
    return pane;
  }

  /** The extension host's `editor.showText`: opens or activates the document's tab. */
  async showText(params: ShowTextEditorParams): Promise<void> {
    await this.ready();
    const data: TextInputData = { tabId: params.tabId, editorId: params.editorId, document: params.document };
    const input: EditorInput = {
      id: tabInputId(params.tabId),
      typeId: TEXT_INPUT,
      label: basename(params.document.path),
      tooltip: params.document.path,
      resource: params.document.uri,
      languageId: params.document.languageId,
      data,
    };
    this.contentPane.open(input, { preserveFocus: params.preserveFocus, preview: params.preview });
    if (params.selection) {
      const pane = this.panes.get(params.editorId);
      pane?.setSelections([{ anchor: params.selection.start, active: params.selection.end }]);
      pane?.revealRange(params.selection, 'center');
    }
  }

  createPane(container: HTMLElement, input: EditorInput, host: EditorHost): TextEditorPane {
    if (!this.monaco || !this.models) {
      throw new Error('text editors are not loaded yet; open documents through ITextEditors');
    }
    const data = input.data as TextInputData;
    const pane = new TextEditorPane(this.monaco, container, data, host, this.models, this.connection, this.dialogs, input.label);
    this.panes.set(data.editorId, pane);
    const dispose = pane.dispose.bind(pane);
    pane.dispose = () => {
      this.panes.delete(data.editorId);
      dispose();
    };
    return pane;
  }

  applyTheme(): void {
    if (!this.loaded) {
      return;
    }
    void this.ready().then(({ highlighting }) => highlighting.setTheme(this.themes.current));
    const fonts = editorFontOptions();
    for (const pane of this.panes.values()) {
      pane.editor.updateOptions(fonts);
    }
    for (const pane of this.diffPanes) {
      pane.editor.updateOptions(fonts);
    }
  }

  /** The extension closed one of its tabs. */
  closeTab(tabId: string): void {
    this.contentPane.remove(tabInputId(tabId));
  }

  /** The extension host is gone: its documents cannot be saved any more. */
  closeAll(): void {
    for (const tab of this.contentPane.tabs) {
      if (tab.input.typeId === TEXT_INPUT || tab.input.typeId === DIFF_INPUT) {
        this.contentPane.remove(tab.input.id);
      }
    }
    this.models?.disposeAll();
  }
}

export const ITextEditors = createServiceId<TextEditorService>('textEditors');

/** Reports which editors the user sees, and which content tab is active, to the extension host. */
function trackVisibleEditors(connection: ExtensionHostConnection, contentPane: ContentPane, layout: Layout): () => void {
  let last = '';
  let lastTab: string | undefined;
  return () => {
    const rpc = connection.rpc;
    if (!rpc) {
      return;
    }
    // What has focus first, then the pane's active tab (while shown), then the tabs in their own windows.
    const shown = [contentPane.current, layout.contentPaneVisible ? contentPane.active : undefined, ...contentPane.floating];
    const visible = [...new Set(shown.flatMap((tab) => tab?.pane.textEditorIds ?? []))];
    const key = visible.join(',');
    if (key !== last) {
      last = key;
      rpc.notify('editor.didChangeVisible', { active: visible[0], visible });
    }
    const data = contentPane.current?.input.data as { tabId?: unknown } | undefined;
    const tabId = typeof data?.tabId === 'string' ? data.tabId : undefined;
    if (tabId && tabId !== lastTab) {
      rpc.notify('tab.didActivate', { tabId });
    }
    lastTab = tabId;
  };
}

export const editorModule: ShellModule = {
  id: 'editor',
  dependsOn: ['contentPane'],
  activate({ services, subscriptions, logger }) {
    const connection = services.get(IExtensionHost);
    const contentPane = services.get(IContentPane);
    const layout = services.get(ILayout);
    const commands = services.get(ICommands);
    const keybindings = services.get(IKeybindings);
    const contextKeys = services.get(IContextKeys);
    const themes = services.get(IThemes);

    const editors = new TextEditorService(connection, contentPane, themes, services.get(IDialogs), logger);
    subscriptions.add(services.register(ITextEditors, editors));
    subscriptions.add(
      services.get(IEditors).register({
        id: 'monaco.text',
        accepts: (input) => input.typeId === TEXT_INPUT,
        create: (container, input, host) => editors.createPane(container, input, host),
      }),
    );
    subscriptions.add(
      services.get(IEditors).register({
        id: 'monaco.diff',
        accepts: (input) => input.typeId === DIFF_INPUT,
        create: (container, input, host) => editors.createDiffPane(container, input, host),
      }),
    );

    subscriptions.add(
      connection.onDidConnect((rpc) => {
        rpc.handle('editor.showText', (params) => editors.showText(params));
        rpc.handle('editor.showDiff', (params) => editors.showDiff(params));
        rpc.handle('editor.setSelections', ({ editorId, selections }) => editors.pane(editorId)?.setSelections(selections));
        rpc.handle('editor.revealRange', ({ editorId, range, revealType }) => editors.pane(editorId)?.revealRange(range, revealType));
        rpc.handle('tab.close', ({ tabId }) => editors.closeTab(tabId));
        rpc.handle('document.applyEdits', ({ uri, edits }) => editors.modelService?.applyEdits(uri, edits) ?? false);
        rpc.handle('document.reload', ({ uri, text }) => editors.modelService?.reload(uri, text));
        rpc.handle('document.didSave', ({ uri }) => editors.modelService?.didSave(uri));
        rpc.handle('document.didChangeOnDisk', ({ uri }) => editors.modelService?.didChangeOnDisk(uri));
      }),
    );
    subscriptions.add(connection.onDidDisconnect(() => editors.closeAll()));
    subscriptions.add(themes.onDidChange(() => editors.applyTheme()));

    const report = trackVisibleEditors(connection, contentPane, layout);
    // A pane can change its editors without changing tabs (Markdown preview <-> source).
    const paneEditors = subscriptions.add(new DisposableStore());
    subscriptions.add(
      contentPane.onDidChangeActive((tab) => {
        paneEditors.clear();
        const onDidChange = tab?.pane.onDidChangeTextEditors;
        if (onDidChange) {
          paneEditors.add(onDidChange(report));
        }
        report();
      }),
    );
    subscriptions.add(layout.onDidChangeContentPaneVisibility(report));
    subscriptions.add(contentPane.onDidChangeFocus(report));
    subscriptions.add(contentPane.onDidChangeFloating(report));

    const updateContext = (): void => {
      contextKeys.set('activeEditorIsText', editors.activeDocument !== undefined);
      contextKeys.set('activeEditorIsDiff', editors.activeDiff !== undefined);
      contextKeys.set('editorTextFocus', contentPane.focusedDocument.activeElement?.closest('.monaco-editor') != null);
    };
    subscriptions.add(contentPane.onDidChangeActive(updateContext));
    subscriptions.add(contentPane.onDidChangeFocus(() => setTimeout(updateContext)));
    const onFocus = (): void => {
      setTimeout(updateContext);
    };
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onFocus);
    subscriptions.add({
      dispose: () => {
        document.removeEventListener('focusin', onFocus);
        document.removeEventListener('focusout', onFocus);
      },
    });

    const register = [
      commands.register(
        'editor.save',
        async () => {
          const uri = editors.activeDocument;
          if (uri && !(await editors.modelService?.save(uri))) {
            await services.get(IDialogs).showMessage({
              severity: 'error',
              message: t('saveFailed', basename(decodeURIComponent(uri))),
              modal: false,
              items: [],
            });
          }
        },
        { title: t('saveCommand'), category: CommandCategory.file, when: 'activeEditorIsText' },
      ),
      commands.register('editor.revert', () => editors.activePane && editors.modelService?.revert(editors.activePane.uri), {
        title: t('revertCommand'),
        category: CommandCategory.file,
        when: 'activeEditorIsText && !activeEditorIsDiff',
      }),
      commands.register(
        'editor.find',
        () => (editors.activePane?.editor ?? editors.activeDiff?.editor.getModifiedEditor())?.getAction('actions.find')?.run(),
        { when: 'activeEditorIsText' },
      ),
      commands.register(
        'editor.compareWithSaved',
        async () => {
          const uri = editors.activePane?.uri;
          if (!uri?.startsWith('file:')) {
            return;
          }
          const name = basename(URI.parse(uri).fsPath);
          const saved = URI.parse(uri).with({ scheme: SAVED_FILE_SCHEME }).toString();
          await connection.executeCommand('vscode.diff', saved, uri, t('compareWithSavedTitle', name));
        },
        { title: t('compareWithSaved'), category: CommandCategory.file, when: 'activeEditorIsText && !activeEditorIsDiff' },
      ),
      commands.register('editor.acceptDiff', () => editors.activeDiff?.runAction('accept'), {
        title: t('acceptCommand'),
        category: 'Claude',
        when: 'activeEditorIsDiff',
      }),
      commands.register('editor.rejectDiff', () => editors.activeDiff?.runAction('reject'), {
        title: t('rejectCommand'),
        category: 'Claude',
        when: 'activeEditorIsDiff',
      }),
      // Main intercepts registered chords before Monaco sees them; hand Ctrl+F back to Monaco.
      keybindings.register({ key: 'ctrl+f', command: 'editor.find', when: 'editorTextFocus' }),
      keybindings.register({ key: 'ctrl+s', command: 'editor.save', when: 'contentPaneFocus && activeEditorIsText' }),
    ];
    register.forEach((disposable) => subscriptions.add(disposable));
  },
};
