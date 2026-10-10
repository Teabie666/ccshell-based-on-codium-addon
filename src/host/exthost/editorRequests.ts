/**
 * Renderer requests about documents and editors (quick open, save, revert...), answered
 * with the compatibility layer's document registry and editor service.
 */

import { readFile } from 'node:fs/promises';
import type { CompatServices } from '../../compat/vscode';
import { Range } from '../../compat/vscode/types';
import { Uri } from '../../compat/vscode/uri';
import type { ILogger } from '../../platform/log';
import { SAVED_FILE_SCHEME, type RangeDto } from '../../platform/protocol';
import type { RendererRpc } from './compatHost';

/** Opens a document in the content pane (quick open, a dropped file, --goto); false if it cannot be read. */
export async function showDocument(
  services: CompatServices,
  params: { uri: string; preserveFocus: boolean; preview: boolean; selection?: RangeDto },
  logger: ILogger,
): Promise<boolean> {
  const { uri, preserveFocus, preview, selection } = params;
  try {
    const document = await services.documents.open(Uri.parse(uri));
    await services.editors.showTextDocument(document, {
      preserveFocus,
      preview,
      selection: selection
        ? new Range(selection.start.line, selection.start.character, selection.end.line, selection.end.character)
        : undefined,
    });
    return true;
  } catch (error) {
    logger.warn(`cannot open ${uri}`, error);
    return false;
  }
}

/** VS Code's default `files.exclude` and `search.exclude`, which quick open honours. */
const QUICK_OPEN_EXCLUDES = ['**/.git/**', '**/.svn/**', '**/.hg/**', '**/node_modules/**', '**/bower_components/**'];

export function registerEditorRequests(
  renderer: RendererRpc,
  services: CompatServices,
  workspaceFolders: readonly string[],
  logger: ILogger,
): void {
  const { documents, fileSystem } = services;

  fileSystem.registerContentProvider(SAVED_FILE_SCHEME, {
    provideTextDocumentContent: (uri) => readFile(uri.with({ scheme: 'file' }).fsPath, 'utf8'),
  });

  renderer.handle('documents.show', (params) => showDocument(services, params, logger));

  renderer.handle('documents.listFiles', async ({ maxResults }) => {
    const root = workspaceFolders[0];
    if (!root) {
      return [];
    }
    const files = await fileSystem.findFiles('**/*', undefined, QUICK_OPEN_EXCLUDES, maxResults, undefined);
    const prefix = Uri.file(root).path.replace(/\/?$/, '/');
    return files.map((file) => (file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.fsPath));
  });

  renderer.handle('document.save', async ({ uri }) => {
    const document = documents.get(uri);
    if (!document) {
      return false;
    }
    try {
      return await document.save();
    } catch (error) {
      logger.error(`saving ${uri} failed`, error);
      return false;
    }
  });

  renderer.handle('document.revert', async ({ uri }) => {
    try {
      await documents.revert(uri);
    } catch (error) {
      logger.error(`reverting ${uri} failed`, error);
    }
  });
}
