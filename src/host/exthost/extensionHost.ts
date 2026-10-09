/**
 * Loads and runs the Claude Code extension inside this utility process.
 */

import * as fs from 'node:fs';
import Module from 'node:module';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import type { MessagePortMain } from 'electron';
import { createVSCodeApi, type CompatServices } from '../../compat/vscode';
import { createExtensionContext } from '../../compat/vscode/extensionContext';
import { Memento } from '../../compat/vscode/memento';
import { RpcEndpoint, type MessageTransport } from '../../platform/ipc';
import { toDisposable } from '../../platform/lifecycle';
import type { ILogger } from '../../platform/log';
import type { ExtHostInitData } from '../../platform/protocol';
import { ClaudeWebviewBridge } from './bridge';
import { PanelRestore } from './panelRestore';
import { createCompatHost, type CompatHostHandle, type MainRpc, type RendererRpc } from './compatHost';
import { readContributions } from './contributions';
import { installVSCodeModule } from './requireHook';
import { registerWorkbenchCommands } from './workbenchCommands';

interface ExtensionModule {
  activate?(context: vscode.ExtensionContext): unknown;
  deactivate?(): unknown;
}

/** The command the panel's "Claude Code" button runs in VS Code. */
const OPEN_CHAT_COMMAND = 'claude-vscode.editor.open';

function portTransport(port: MessagePortMain): MessageTransport<MessagePortMain> {
  return {
    send: (message, transfer) => port.postMessage(message, transfer ?? []),
    listen: (handler) => {
      const listener = (event: Electron.MessageEvent): void => handler(event.data, event.ports);
      port.on('message', listener);
      port.start();
      return toDisposable(() => port.off('message', listener));
    },
  };
}

export class ExtensionHost {
  private renderer: RendererRpc | undefined;
  private compat: CompatHostHandle | undefined;
  private services: CompatServices | undefined;
  private extension: ExtensionModule | undefined;
  private context: vscode.ExtensionContext | undefined;
  private panelRestore: PanelRestore | undefined;
  private readonly rendererReady: Promise<void>;
  private markRendererReady: () => void = () => {};
  /** Settles once `activate` has run; true when it succeeded. */
  private activation: Promise<boolean> = Promise.resolve(false);

  constructor(
    private readonly main: MainRpc,
    private readonly logger: ILogger,
  ) {
    this.rendererReady = new Promise((resolve) => {
      this.markRendererReady = resolve;
    });
  }

  initialize(init: ExtHostInitData, rendererPort: MessagePortMain): void {
    const renderer: RendererRpc = new RpcEndpoint(portTransport(rendererPort), 'exthost<->renderer', this.logger.child('rpc'));
    this.renderer = renderer;
    renderer.handle('renderer.ready', () => this.markRendererReady());
    // Extension commands and view providers only exist once activate() has run.
    renderer.handle('commands.execute', async ({ id, args }) => {
      await this.activation;
      return this.services?.commands.executeCommand(id, ...args);
    });
    renderer.handle('view.resolve', async ({ viewType }) => {
      await this.activation;
      return this.services?.webviews.resolveView(viewType) ?? false;
    });

    const packageJson = JSON.parse(fs.readFileSync(path.join(init.extensionPath, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const extensionId = `${String(packageJson.publisher)}.${String(packageJson.name)}`.toLowerCase();
    renderer.handle('extension.contributions', () => readContributions(packageJson));

    const compat = createCompatHost({
      init,
      extensionId,
      packageJson,
      main: this.main,
      renderer,
      logger: this.logger.child('compat'),
    });
    this.compat = compat;
    const { api, services } = createVSCodeApi(compat.host, {
      onShowOutput: (channel) => this.logger.info(`output channel "${channel.name}" is at ${channel.filePath}`),
      onShowDocument: (document) => this.logger.info(`open document requested (editor arrives in M2): ${document.fileName}`),
    });
    this.services = services;
    registerWorkbenchCommands(services.commands);
    this.panelRestore = new PanelRestore(services.webviews, compat.host.storage, this.logger.child('restore'));
    services.webviews.interceptor = new ClaudeWebviewBridge(compat.host.os, this.logger.child('bridge'), {
      diffEditorAvailable: () => false,
    });
    installVSCodeModule(api);

    this.activation = this.activate(init, packageJson, compat, services);
    void this.activation.then((activated) => (activated ? this.openInitialView(services) : undefined));
  }

  settingsChanged(settings: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
    this.compat?.settingsChanged(settings, keys);
  }

  async shutdown(): Promise<void> {
    // Record the open panels before deactivate() closes them.
    this.panelRestore?.freeze();
    try {
      await this.extension?.deactivate?.();
    } catch (error) {
      this.logger.error('extension deactivate failed', error);
    }
    for (const subscription of this.context?.subscriptions ?? []) {
      try {
        subscription.dispose();
      } catch (error) {
        this.logger.warn('disposing an extension subscription failed', error);
      }
    }
    this.services?.webviews.dispose();
    this.renderer?.dispose();
  }

  private async activate(
    init: ExtHostInitData,
    packageJson: Record<string, unknown>,
    compat: CompatHostHandle,
    services: CompatServices,
  ): Promise<boolean> {
    const version = String(packageJson.version);
    try {
      const mainFile = path.join(init.extensionPath, String(packageJson.main ?? 'extension.js'));
      const load = Module.createRequire(mainFile);
      this.extension = load(mainFile) as ExtensionModule;
      const context = createExtensionContext(
        compat.host,
        new Memento('global', compat.host.storage),
        new Memento('workspace', compat.host.storage),
        services.extensionObject,
      );
      this.context = context;
      const started = Date.now();
      const exports = await this.extension.activate?.(context);
      services.setExtensionExports(exports);
      this.logger.info(`activated Claude Code ${version} in ${Date.now() - started} ms`);
      this.main.notify('exthost.activated', { extensionVersion: version });
      return true;
    } catch (error) {
      this.logger.error('activation failed', error);
      const err = error instanceof Error ? error : new Error(String(error));
      this.main.notify('exthost.activationFailed', { message: err.message, stack: err.stack });
      return false;
    }
  }

  private async openInitialView(services: CompatServices): Promise<void> {
    await this.rendererReady;
    const restored = (await this.panelRestore?.restore()) ?? 0;
    if (restored === 0 && services.webviews.allPanels.length === 0) {
      await services.commands.executeCommand(OPEN_CHAT_COMMAND);
    }
  }
}
