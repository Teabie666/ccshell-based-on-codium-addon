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
import type { ILogger } from '../../platform/log';
import { getUiLanguage } from '../../platform/nls';
import type { ShowTextEditorParams } from '../../platform/protocol';
import { IContentPane } from '../contentPane';
import type { ContentPane } from '../contentPane/contentPane';
import { Highlighting } from './highlighting';
import { t } from './messages';
import { loadMonaco, type MonacoApi } from './monaco';
import { TextEditorPane, editorFontOptions, type TextInputData } from './textEditorPane';
import { TextModels } from './textModels';

const TEXT_INPUT = 'text';

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export class TextEditorService {
  private loaded: Promise<{ monaco: MonacoApi; models: TextModels; highlighting: Highlighting }> | undefined;
  private monaco: MonacoApi | undefined;
  private models: TextModels | undefined;
  /** Text editor panes by the editor id the extension host assigned. */
  private readonly panes = new Map<string, TextEditorPane>();

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

  pane(editorId: string): TextEditorPane | undefined {
    return this.panes.get(editorId);
  }

  get activePane(): TextEditorPane | undefined {
    const pane = this.contentPane.active?.pane;
    return pane instanceof TextEditorPane ? pane : undefined;
  }

  /** The extension host's `editor.showText`: opens or activates the document's tab. */
  async showText(params: ShowTextEditorParams): Promise<void> {
    await this.ready();
    const data: TextInputData = { tabId: params.tabId, editorId: params.editorId, document: params.document };
    const input: EditorInput = {
      id: `${TEXT_INPUT}:${params.tabId}`,
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
  }

  /** The extension host is gone: its documents cannot be saved any more. */
  closeAll(): void {
    for (const tab of this.contentPane.tabs) {
      if (tab.input.typeId === TEXT_INPUT) {
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
  return () => {
    const rpc = connection.rpc;
    if (!rpc) {
      return;
    }
    const pane = contentPane.active?.pane;
    const visible = layout.contentPaneVisible && pane?.textEditorIds ? [...pane.textEditorIds] : [];
    const key = visible.join(',');
    if (key !== last) {
      last = key;
      rpc.notify('editor.didChangeVisible', { active: visible[0], visible });
    }
    const data = contentPane.active?.input.data as { tabId?: unknown } | undefined;
    if (typeof data?.tabId === 'string') {
      rpc.notify('tab.didActivate', { tabId: data.tabId });
    }
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
      connection.onDidConnect((rpc) => {
        rpc.handle('editor.showText', (params) => editors.showText(params));
        rpc.handle('editor.setSelections', ({ editorId, selections }) => editors.pane(editorId)?.setSelections(selections));
        rpc.handle('editor.revealRange', ({ editorId, range, revealType }) => editors.pane(editorId)?.revealRange(range, revealType));
        rpc.handle('tab.close', ({ tabId }) => contentPane.remove(`${TEXT_INPUT}:${tabId}`));
        rpc.handle('document.applyEdits', ({ uri, edits }) => editors.modelService?.applyEdits(uri, edits) ?? false);
        rpc.handle('document.reload', ({ uri, text }) => editors.modelService?.reload(uri, text));
        rpc.handle('document.didSave', ({ uri }) => editors.modelService?.didSave(uri));
        rpc.handle('document.didChangeOnDisk', ({ uri }) => editors.modelService?.didChangeOnDisk(uri));
      }),
    );
    subscriptions.add(connection.onDidDisconnect(() => editors.closeAll()));
    subscriptions.add(themes.onDidChange(() => editors.applyTheme()));

    const report = trackVisibleEditors(connection, contentPane, layout);
    subscriptions.add(contentPane.onDidChangeActive(report));
    subscriptions.add(layout.onDidChangeContentPaneVisibility(report));

    const updateContext = (): void => {
      contextKeys.set('activeEditorIsText', editors.activePane !== undefined);
      contextKeys.set('editorTextFocus', document.activeElement?.closest('.monaco-editor') != null);
    };
    subscriptions.add(contentPane.onDidChangeActive(updateContext));
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
          const pane = editors.activePane;
          if (pane && !(await editors.modelService?.save(pane.uri))) {
            await services.get(IDialogs).showMessage({
              severity: 'error',
              message: t('saveFailed', basename(pane.uri)),
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
        when: 'activeEditorIsText',
      }),
      commands.register('editor.find', () => editors.activePane?.editor.getAction('actions.find')?.run(), {
        when: 'activeEditorIsText',
      }),
      // Main intercepts registered chords before Monaco sees them; hand Ctrl+F back to Monaco.
      keybindings.register({ key: 'ctrl+f', command: 'editor.find', when: 'editorTextFocus' }),
      keybindings.register({ key: 'ctrl+s', command: 'editor.save', when: 'contentPaneFocus && activeEditorIsText' }),
    ];
    register.forEach((disposable) => subscriptions.add(disposable));
  },
};
