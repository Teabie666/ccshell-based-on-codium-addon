/**
 * Disposable primitives shared by every process (main, extension host, renderer).
 * Anything that registers a listener, timer or resource hands back an IDisposable,
 * and owners collect them in a DisposableStore so teardown is one call.
 */

export interface IDisposable {
  dispose(): void;
}

export function toDisposable(fn: () => void): IDisposable {
  let disposed = false;
  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      fn();
    },
  };
}

/** Disposes every item even if some of them throw, then rethrows the first error. */
export function disposeAll(items: Iterable<IDisposable | undefined>): void {
  let firstError: unknown;
  for (const item of items) {
    try {
      item?.dispose();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) {
    throw firstError;
  }
}

export class DisposableStore implements IDisposable {
  private readonly items = new Set<IDisposable>();
  private disposed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Adding to a disposed store disposes the item immediately, so late registrations never leak. */
  add<T extends IDisposable>(item: T): T {
    if (this.disposed) {
      item.dispose();
    } else {
      this.items.add(item);
    }
    return item;
  }

  /** Removes the item and disposes it. */
  delete(item: IDisposable): void {
    if (this.items.delete(item)) {
      item.dispose();
    }
  }

  clear(): void {
    const items = [...this.items];
    this.items.clear();
    disposeAll(items);
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }
}

export abstract class Disposable implements IDisposable {
  protected readonly store = new DisposableStore();

  protected register<T extends IDisposable>(item: T): T {
    return this.store.add(item);
  }

  dispose(): void {
    this.store.dispose();
  }
}
