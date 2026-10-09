/** Cancellation tokens with the same shape as `vscode.CancellationToken`. */

import { Emitter, Event } from './event';
import type { IDisposable } from './lifecycle';

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  readonly onCancellationRequested: Event<void>;
}

/**
 * The event of an already cancelled token: calls the listener once, asynchronously.
 * Like VS Code's shortcutEvent it ignores `disposables`; extensions are written against that.
 */
const shortcutEvent: Event<void> = (listener, thisArgs) => {
  const handle = setTimeout(() => listener.call(thisArgs, undefined), 0);
  return { dispose: () => clearTimeout(handle) };
};

export const CancellationToken = {
  None: Object.freeze<CancellationToken>({
    isCancellationRequested: false,
    onCancellationRequested: Event.None,
  }),
  Cancelled: Object.freeze<CancellationToken>({
    isCancellationRequested: true,
    onCancellationRequested: shortcutEvent,
  }),
};

class MutableToken implements CancellationToken {
  private cancelled = false;
  private emitter: Emitter<void> | undefined;

  get isCancellationRequested(): boolean {
    return this.cancelled;
  }

  get onCancellationRequested(): Event<void> {
    if (this.cancelled) {
      return shortcutEvent;
    }
    this.emitter ??= new Emitter<void>();
    return this.emitter.event;
  }

  cancel(): void {
    if (this.cancelled) {
      return;
    }
    this.cancelled = true;
    this.emitter?.fire(undefined);
    this.emitter?.dispose();
    this.emitter = undefined;
  }

  dispose(): void {
    this.emitter?.dispose();
    this.emitter = undefined;
  }
}

export class CancellationTokenSource implements IDisposable {
  private tokenInstance: MutableToken | undefined;
  private cancelledBeforeToken = false;

  get token(): CancellationToken {
    if (this.cancelledBeforeToken) {
      return CancellationToken.Cancelled;
    }
    this.tokenInstance ??= new MutableToken();
    return this.tokenInstance;
  }

  cancel(): void {
    if (this.tokenInstance) {
      this.tokenInstance.cancel();
    } else {
      this.cancelledBeforeToken = true;
    }
  }

  dispose(cancel = false): void {
    if (cancel) {
      this.cancel();
    }
    this.tokenInstance?.dispose();
  }
}

export class CancellationError extends Error {
  constructor() {
    super('Canceled');
    this.name = 'Canceled';
  }
}
