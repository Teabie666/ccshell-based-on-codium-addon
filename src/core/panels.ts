/**
 * Routes the extension's webview panels to the module that shows them: the conversation
 * area (`main`) or the content pane (`side`). The extension host decides the area from the
 * panel's view column; modules register as the host of an area.
 */

import type { IDisposable } from '../platform/lifecycle';
import type { ILogger } from '../platform/log';
import type { PanelArea, PanelCreateParams, PanelUpdateParams } from '../platform/protocol';
import type { ExtensionHostConnection } from './extensionHost';

export interface PanelHost {
  create(params: PanelCreateParams): void;
  update(params: PanelUpdateParams): void;
  reveal(panelId: string, preserveFocus: boolean): void;
  remove(panelId: string): void;
}

export class PanelRouter {
  private readonly hosts = new Map<PanelArea, PanelHost>();
  private readonly owners = new Map<string, PanelHost>();

  constructor(connection: ExtensionHostConnection, logger: ILogger) {
    connection.onDidConnect((rpc) => {
      rpc.handle('panel.create', (params) => {
        // Without a content pane, side panels still show, among the conversations.
        const host = this.hosts.get(params.area) ?? this.hosts.get('main');
        if (!host) {
          logger.error(`no host for panel ${params.viewType}`);
          return;
        }
        this.owners.set(params.panelId, host);
        host.create(params);
      });
      rpc.handle('panel.update', (params) => this.owners.get(params.panelId)?.update(params));
      rpc.handle('panel.reveal', ({ panelId, preserveFocus }) => this.owners.get(panelId)?.reveal(panelId, preserveFocus));
      rpc.handle('panel.dispose', ({ panelId }) => {
        const host = this.owners.get(panelId);
        this.owners.delete(panelId);
        host?.remove(panelId);
      });
    });
    connection.onDidDisconnect(() => this.owners.clear());
  }

  registerHost(area: PanelArea, host: PanelHost): IDisposable {
    this.hosts.set(area, host);
    return {
      dispose: () => {
        if (this.hosts.get(area) === host) {
          this.hosts.delete(area);
        }
      },
    };
  }
}
