/**
 * Makes `require('vscode')` return our compatibility API, the same technique VS Code's
 * own extension host uses (it patches Module._load).
 */

import Module from 'node:module';

type LoadFunction = (this: unknown, request: string, parent: unknown, isMain: boolean) => unknown;

let installed = false;

export function installVSCodeModule(api: object): void {
  if (installed) {
    throw new Error('vscode module hook installed twice');
  }
  installed = true;
  const moduleInternals = Module as unknown as { _load: LoadFunction };
  const originalLoad = moduleInternals._load;
  moduleInternals._load = function load(request, parent, isMain) {
    if (request === 'vscode') {
      return api;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}
