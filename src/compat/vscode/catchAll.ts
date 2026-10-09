/**
 * Graceful degradation for VS Code API members we have not implemented.
 *
 * Instead of `undefined` (which would crash the extension on the next property access or
 * call), unknown members resolve to a "stub": callable, constructible, and itself made of
 * stubs. Every first use is reported, so `logs/<run>/shim-unimplemented.log` tells us
 * exactly what a new extension version started using.
 */

type Report = (member: string) => void;

/** Calls to these return disposables, because their result is usually pushed to subscriptions. */
const EVENT_NAME = /(^|\.)on[A-Z]\w*$/;

function stubResult(path: string, report: Report): unknown {
  if (EVENT_NAME.test(path)) {
    return { dispose() {} };
  }
  return createStub(`${path}()`, report);
}

export function createStub(path: string, report: Report): unknown {
  const target = function stub(): void {};
  return new Proxy(target, {
    get(_target, property) {
      if (property === 'then' || typeof property === 'symbol') {
        // Never look like a thenable or an iterator.
        return undefined;
      }
      if (property === 'toString' || property === 'valueOf') {
        return () => '';
      }
      if (property === 'dispose') {
        return () => {};
      }
      const member = `${path}.${property}`;
      report(member);
      return createStub(member, report);
    },
    apply() {
      report(`${path}()`);
      return stubResult(path, report);
    },
    construct() {
      report(`new ${path}()`);
      return createStub(`new ${path}()`, report) as object;
    },
  });
}

/** Wraps a namespace object (e.g. `vscode.window`) so missing members become reported stubs. */
export function withStubs<T extends object>(namespace: T, path: string, report: Report): T {
  return new Proxy(namespace, {
    get(target, property, receiver) {
      if (typeof property === 'symbol' || property in target) {
        return Reflect.get(target, property, receiver);
      }
      if (property === 'then') {
        return undefined;
      }
      const member = `${path}.${property}`;
      report(member);
      return createStub(member, report);
    },
  });
}

/**
 * A prototype for the root `vscode` module object. The extension's bundler copies the
 * module's own properties onto a fresh object whose prototype is this one, so lookups of
 * root members we did not define still land here.
 */
export function createStubPrototype(path: string, report: Report): object {
  return new Proxy(Object.create(null) as object, {
    get(_target, property) {
      if (typeof property === 'symbol' || property === 'then' || property === '__esModule') {
        return undefined;
      }
      const member = `${path}.${property}`;
      report(member);
      return createStub(member, report);
    },
  });
}
