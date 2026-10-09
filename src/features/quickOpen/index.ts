/**
 * Opening files by hand: Ctrl+P quick open over the workspace files, and files dropped onto
 * the window (outside the webviews, which handle their own drops). Both go through the
 * extension host, so the extension sees the document open like in VS Code.
 */

import { URI } from 'vscode-uri';
import type { ShellModule } from '../../core/module';
import { native } from '../../core/native';
import { ICommands, IDialogs, IExtensionHost, IKeybindings, IWorkspace } from '../../core/serviceIds';
import { scorePath } from './fuzzy';
import { t } from './messages';

/** Files listed for quick open; a huge workspace is cut off here. */
const MAX_FILES = 20_000;
/** Rows rendered at once while typing. */
const MAX_ROWS = 200;

export const quickOpenModule: ShellModule = {
  id: 'quickOpen',
  activate({ services, subscriptions, logger }) {
    const commands = services.get(ICommands);
    const keybindings = services.get(IKeybindings);
    const dialogs = services.get(IDialogs);
    const connection = services.get(IExtensionHost);
    const workspace = services.get(IWorkspace);

    const open = async (path: string, preview: boolean): Promise<void> => {
      const rpc = connection.rpc;
      const opened = rpc ? await rpc.call('documents.show', { uri: URI.file(path).toString(), preserveFocus: false, preview }) : false;
      if (!opened) {
        await dialogs.showMessage({ severity: 'error', message: t('cannotOpen', path), modal: false, items: [] });
      }
    };

    subscriptions.add(
      commands.register(
        'quickOpen.show',
        async () => {
          const root = workspace.folders[0];
          const rpc = connection.rpc;
          if (!root || !rpc) {
            await dialogs.showMessage({ severity: 'info', message: t('noFolder'), modal: false, items: [] });
            return;
          }
          const files = await rpc.call('documents.listFiles', { maxResults: MAX_FILES });
          const items = files.map((file) => {
            const slash = file.lastIndexOf('/');
            return { label: file.slice(slash + 1), description: slash > 0 ? file.slice(0, slash) : undefined };
          });
          const picked = await dialogs.showQuickPick(
            { items, placeHolder: t('placeholder'), canPickMany: false },
            {
              score: (item, query) => scorePath(item.description ? `${item.description}/${item.label}` : item.label, query),
              limit: MAX_ROWS,
            },
          );
          const index = picked?.[0];
          if (index !== undefined && files[index] !== undefined) {
            await open(`${root}/${files[index]}`, true);
          }
        },
        { title: t('goToFile') },
      ),
    );
    subscriptions.add(keybindings.register({ key: 'ctrl+p', command: 'quickOpen.show' }));
    subscriptions.add(keybindings.register({ key: 'ctrl+e', command: 'quickOpen.show' }));

    // Files dropped onto the shell (the content pane, empty states...) open as tabs.
    const onDragOver = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }
    };
    const onDrop = (event: DragEvent): void => {
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) {
        return;
      }
      event.preventDefault();
      for (const file of files) {
        const path = native.pathForFile(file);
        if (path) {
          void open(path, false).catch((error: unknown) => logger.error(`opening dropped ${path} failed`, error));
        }
      }
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    subscriptions.add({
      dispose: () => {
        document.removeEventListener('dragover', onDragOver);
        document.removeEventListener('drop', onDrop);
      },
    });
  },
};
