/**
 * Runs the extension host (src/host/exthost/main.ts) in an Electron utility process,
 * the way VS Code isolates extensions: a slow or crashing extension cannot freeze or
 * take down the window.
 */

import { once } from 'node:events';
import * as readline from 'node:readline';
import { utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron';
import { Emitter, type Event } from '../../platform/event';
import { RpcEndpoint, type MessageTransport } from '../../platform/ipc';
import { Disposable, toDisposable } from '../../platform/lifecycle';
import type { ILogger } from '../../platform/log';
import type { ExtHostApiForMain, MainApiForExtHost } from '../../platform/protocol';
import { cleanEnvironment } from '../node/environment';

export interface ExtHostExit {
  readonly code: number;
  /** True when we asked it to stop. */
  readonly expected: boolean;
}

const SHUTDOWN_TIMEOUT_MS = 5000;

export class ExtHostProcess extends Disposable {
  readonly rpc: RpcEndpoint<MainApiForExtHost, ExtHostApiForMain, MessagePortMain>;
  private readonly exitEmitter = this.register(new Emitter<ExtHostExit>());
  readonly onDidExit: Event<ExtHostExit> = this.exitEmitter.event;
  private stopping = false;
  private exited = false;

  private constructor(
    private readonly child: UtilityProcess,
    private readonly logger: ILogger,
  ) {
    super();
    pipeLines(child.stdout, (line) => logger.info(`[stdout] ${line}`));
    pipeLines(child.stderr, (line) => logger.warn(`[stderr] ${line}`));

    const transport: MessageTransport<MessagePortMain> = {
      send: (message, transfer) => child.postMessage(message, transfer),
      listen: (handler) => {
        const listener = (message: unknown): void => handler(message, []);
        child.on('message', listener);
        return toDisposable(() => child.off('message', listener));
      },
    };
    this.rpc = this.register(new RpcEndpoint(transport, 'main<->exthost', logger));

    child.on('exit', (code) => {
      this.exited = true;
      if (!this.stopping) {
        logger.error(`extension host exited unexpectedly with code ${code}`);
      }
      this.exitEmitter.fire({ code, expected: this.stopping });
    });
  }

  static async start(entryScript: string, logger: ILogger): Promise<ExtHostProcess> {
    const child = utilityProcess.fork(entryScript, [], {
      serviceName: 'vilaus extension host',
      stdio: 'pipe',
      env: cleanEnvironment(),
    });
    const host = new ExtHostProcess(child, logger);
    await once(child, 'spawn');
    logger.info(`extension host started, pid ${child.pid}`);
    return host;
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  /** Lets the extension deactivate (it stops its Claude processes), then kills the host. */
  async shutdown(): Promise<void> {
    if (this.exited) {
      return;
    }
    this.stopping = true;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.rpc.call('shutdown', undefined),
        new Promise((resolve) => {
          timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      this.logger.warn('extension host shutdown call failed', error);
    } finally {
      clearTimeout(timer);
    }
    if (!this.exited) {
      this.child.kill();
    }
  }
}

function pipeLines(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void): void {
  if (!stream) {
    return;
  }
  readline.createInterface({ input: stream }).on('line', onLine);
}
