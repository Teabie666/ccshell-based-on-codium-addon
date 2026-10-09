/**
 * Markdown documents open as a rendered preview (with a toggle to the source), like the
 * plan and notes files Claude writes. Claims Markdown text inputs over the plain editor.
 */

import { URI } from 'vscode-uri';
import type { ShellModule } from '../../core/module';
import { native } from '../../core/native';
import { ICommands, IContextKeys, IEditors, IExtensionHost, IKeybindings, IThemes } from '../../core/serviceIds';
import { IContentPane } from '../contentPane';
import { ITextEditors, TEXT_INPUT } from '../editor';
import { MarkdownPane, type LinkHandler } from './markdownPane';
import { t } from './messages';

export const markdownModule: ShellModule = {
  id: 'markdown',
  dependsOn: ['editor'],
  activate({ services, subscriptions, logger }) {
    const editors = services.get(ITextEditors);
    const contentPane = services.get(IContentPane);
    const connection = services.get(IExtensionHost);
    const contextKeys = services.get(IContextKeys);
    const panes = new Set<MarkdownPane>();

    const links: LinkHandler = {
      openExternal: (url) => void native.call('os.openExternal', { url }),
      openFile: (path) =>
        void connection.rpc
          ?.call('documents.show', { uri: URI.file(path).toString(), preserveFocus: false, preview: true })
          .catch((error: unknown) => logger.warn(`cannot open ${path}`, error)),
    };

    subscriptions.add(
      services.get(IEditors).register({
        id: 'markdown.preview',
        // Over the plain text editor, which it embeds for the source view.
        priority: 10,
        accepts: (input) => input.typeId === TEXT_INPUT && input.languageId === 'markdown',
        create: (container, input, host) => {
          const pane = new MarkdownPane(container, input, host, editors, links, logger);
          panes.add(pane);
          const dispose = pane.dispose.bind(pane);
          pane.dispose = () => {
            panes.delete(pane);
            dispose();
          };
          return pane;
        },
      }),
    );
    subscriptions.add(services.get(IThemes).onDidChange(() => panes.forEach((pane) => pane.refresh())));

    const activeMarkdown = (): MarkdownPane | undefined => {
      const pane = contentPane.active?.pane;
      return pane instanceof MarkdownPane ? pane : undefined;
    };
    subscriptions.add(contentPane.onDidChangeActive(() => contextKeys.set('activeEditorIsMarkdown', activeMarkdown() !== undefined)));
    subscriptions.add(
      services.get(ICommands).register(
        'markdown.togglePreview',
        () => {
          const pane = activeMarkdown();
          pane?.setMode(pane.isSource ? 'preview' : 'source');
        },
        { title: t('togglePreview'), category: 'Markdown', when: 'activeEditorIsMarkdown' },
      ),
    );
    subscriptions.add(
      services.get(IKeybindings).register({ key: 'ctrl+shift+v', command: 'markdown.togglePreview', when: 'activeEditorIsMarkdown' }),
    );
  },
};
