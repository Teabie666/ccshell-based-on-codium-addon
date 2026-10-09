/**
 * The renderer's connection to the extension host. The host can restart (after a crash
 * or a renderer reload), each time with a new MessagePort, so features never hold on to
 * an RPC endpoint: they register their handlers in `onDidConnect`, and clean up their
 * UI in `onDidDisconnect`.
 */

import { Emitter, type Event } from '../platform/event';
import { RpcEndpoint, type MessageTransport } from '../platform/ipc';
import { toDisposable } from '../platform/lifecycle';
import type { ILogger } from '../platform/log';
import type { ExtHostApiForRenderer, RendererApiForExtHost } from '../platform/protocol';

export type ExtHostRpc = RpcEndpoint<RendererApiForExtHost, ExtHostApiForRenderer, MessagePort>;

function portTransport(port: MessagePort): MessageTransport<MessagePort> {
  return {
    send: (message, transfer) => port.postMessage(message, transfer ?? []),
    listen: (handler) => {
      const listener = (event: MessageEvent): void => handler(event.data, event.ports);
      port.addEventListener('message', listener);
      port.start();
      return toDisposable(() => port.removeEventListener('message', listener));
    },
  };
}

export class ExtensionHostConnection {
  private rpcValue: ExtHostRpc | undefined;
  private started = false;
  private pendingPort: MessagePort | undefined;
  private readonly connectEmitter = new Emitter<ExtHostRpc>();
  private readonly disconnectEmitter = new Emitter<void>();
  /** Register this connection's RPC handlers here. */
  readonly onDidConnect: Event<ExtHostRpc> = this.connectEmitter.event;
  /** The extension host went away; every panel and view it owned is gone. */
  readonly onDidDisconnect: Event<void> = this.disconnectEmitter.event;

  constructor(private readonly logger: ILogger) {}

  get rpc(): ExtHostRpc | undefined {
    return this.rpcValue;
  }

  get isConnected(): boolean {
    return this.rpcValue !== undefined;
  }

  /** Called for every port main sends. Before `start()`, the port is kept until modules are ready. */
  connect(port: MessagePort): void {
    if (!this.started) {
      this.pendingPort = port;
      return;
    }
    this.disconnect();
    const rpc: ExtHostRpc = new RpcEndpoint(portTransport(port), 'renderer<->exthost', this.logger.child('rpc'));
    this.rpcValue = rpc;
    this.connectEmitter.fire(rpc);
    rpc.notify('renderer.ready', undefined);
    this.logger.info('connected to the extension host');
  }

  disconnect(): void {
    if (!this.rpcValue) {
      return;
    }
    this.rpcValue.dispose();
    this.rpcValue = undefined;
    this.disconnectEmitter.fire();
  }

  /** Call once every module has subscribed to onDidConnect. */
  start(): void {
    this.started = true;
    const port = this.pendingPort;
    this.pendingPort = undefined;
    if (port) {
      this.connect(port);
    }
  }

  /** Runs a command registered by the extension (e.g. `claude-vscode.editor.open`). */
  executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
    if (!this.rpcValue) {
      return Promise.reject(new Error(`extension host not connected; cannot run ${id}`));
    }
    return this.rpcValue.call('commands.execute', { id, args });
  }
}
