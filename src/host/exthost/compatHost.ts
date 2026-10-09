/**
 * Implements the compatibility layer's CompatHost on top of the two RPC channels:
 * main (settings, storage, OS services, webview documents) and the renderer (UI, panels).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MessagePortMain } from 'electron';
import type { CompatHost, OutputSink } from '../../compat/vscode/host';
import { Emitter } from '../../platform/event';
import type { RpcEndpoint } from '../../platform/ipc';
import type { ILogger } from '../../platform/log';
import type {
  ExtHostApiForMain,
  ExtHostApiForRenderer,
  ExtHostInitData,
  MainApiForExtHost,
  RendererApiForExtHost,
} from '../../platform/protocol';

export type MainRpc = RpcEndpoint<ExtHostApiForMain, MainApiForExtHost, MessagePortMain>;
export type RendererRpc = RpcEndpoint<ExtHostApiForRenderer, RendererApiForExtHost, MessagePortMain>;

export interface CompatHostHandle {
  readonly host: CompatHost;
  /** Main reported that settings.json changed. */
  settingsChanged(settings: Readonly<Record<string, unknown>>, keys: readonly string[]): void;
}

class FileAppender implements OutputSink {
  private stream: fs.WriteStream | undefined;

  constructor(readonly filePath: string) {}

  append(text: string): void {
    if (!this.stream) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      this.stream = fs.createWriteStream(this.filePath, { flags: 'a', encoding: 'utf8' });
    }
    this.stream.write(text);
  }

  dispose(): void {
    this.stream?.end();
    this.stream = undefined;
  }
}

function safeFileName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'output';
}

export function createCompatHost(options: {
  readonly init: ExtHostInitData;
  readonly extensionId: string;
  readonly packageJson: Readonly<Record<string, unknown>>;
  readonly main: MainRpc;
  readonly renderer: RendererRpc;
  readonly logger: ILogger;
}): CompatHostHandle {
  const { init, main, renderer, logger } = options;

  let settingsValues: Readonly<Record<string, unknown>> = init.settings;
  const settingsEmitter = new Emitter<{ readonly keys: readonly string[] }>();

  const webviewMessages = new Emitter<{ webviewId: string; message: unknown }>();
  const webviewStates = new Emitter<{ webviewId: string; state: unknown }>();
  const panelViewStates = new Emitter<{ panelId: string; active: boolean; visible: boolean }>();
  const panelCloses = new Emitter<{ panelId: string }>();
  const viewVisibility = new Emitter<{ viewId: string; visible: boolean }>();
  renderer.handle('webview.didReceiveMessage', (params) => webviewMessages.fire(params));
  renderer.handle('webview.didUpdateState', (params) => webviewStates.fire(params));
  renderer.handle('webview.didLoad', () => {});
  renderer.handle('panel.didChangeViewState', (params) => panelViewStates.fire(params));
  renderer.handle('panel.didClose', (params) => panelCloses.fire(params));
  renderer.handle('view.didChangeVisibility', (params) => viewVisibility.fire(params));

  const reported = new Set<string>();
  const unimplementedLog = new FileAppender(path.join(init.paths.logs, 'shim-unimplemented.log'));

  const host: CompatHost = {
    logger,
    app: init.app,
    paths: init.paths,
    extension: { id: options.extensionId, path: init.extensionPath, packageJson: options.packageJson },
    workspaceFolders: init.workspaceFolders,
    themeKind: init.themeKind,

    settings: {
      get values() {
        return settingsValues;
      },
      update: (key, value) => main.call('settings.set', { key, value }),
      onDidChange: settingsEmitter.event,
    },

    storage: {
      initial: (scope) => (scope === 'global' ? init.globalState : init.workspaceState),
      set: (scope, key, value) => main.notify('storage.set', { scope, key, value }),
    },

    os: {
      openExternal: (url) => main.call('os.openExternal', { url }),
      clipboardRead: () => main.call('os.clipboardRead', undefined),
      clipboardWrite: (text) => main.call('os.clipboardWrite', { text }),
    },

    ui: {
      showMessage: (request) => renderer.call('ui.showMessage', request),
      showQuickPick: (request) => renderer.call('ui.showQuickPick', request),
      showInputBox: (request) => renderer.call('ui.showInputBox', request),
    },

    webviews: {
      setDocument: (document) => main.call('webview.setDocument', document),
      releaseDocument: (webviewId) => main.notify('webview.releaseDocument', { webviewId }),
      load: (webviewId, url) => renderer.notify('webview.load', { webviewId, url }),
      postMessage: (webviewId, message) => renderer.notify('webview.postMessage', { webviewId, message }),
      createPanel: (params) => renderer.notify('panel.create', params),
      updatePanel: (params) => renderer.notify('panel.update', params),
      revealPanel: (panelId, preserveFocus) => renderer.notify('panel.reveal', { panelId, preserveFocus }),
      disposePanel: (panelId) => renderer.notify('panel.dispose', { panelId }),
      createView: (params) => renderer.notify('view.create', params),
      updateView: (params) => renderer.notify('view.update', params),
      revealView: (viewId, preserveFocus) => renderer.notify('view.reveal', { viewId, preserveFocus }),
      disposeView: (viewId) => renderer.notify('view.dispose', { viewId }),
      onDidChangeViewVisibility: viewVisibility.event,
      onDidReceiveMessage: webviewMessages.event,
      onDidUpdateState: webviewStates.event,
      onDidChangePanelViewState: panelViewStates.event,
      onDidClosePanel: panelCloses.event,
    },

    reportUnimplemented(member) {
      if (reported.has(member)) {
        return;
      }
      reported.add(member);
      logger.warn(`unimplemented VS Code API used: ${member}`);
      unimplementedLog.append(`${new Date().toISOString()} ${member}\n`);
    },

    createOutputSink: (name) => new FileAppender(path.join(init.paths.logs, 'output', `${safeFileName(name)}.log`)),
  };

  return {
    host,
    settingsChanged(settings, keys) {
      settingsValues = settings;
      settingsEmitter.fire({ keys });
    },
  };
}
