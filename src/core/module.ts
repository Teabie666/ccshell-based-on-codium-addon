/**
 * Shell modules. Every UI feature (conversations, session list, themes, ...) is a module
 * that receives a ShellContext and contributes through registered services. Built-in
 * features use exactly the API a future plugin system would expose.
 */

import { DisposableStore, type IDisposable } from '../platform/lifecycle';
import type { ILogger } from '../platform/log';
import type { ServiceRegistry } from './services';

/** Version of the ShellContext contract; bump on breaking changes. */
export const SHELL_API_VERSION = 1;

export interface ShellModule {
  readonly id: string;
  /** Ids of modules that must activate before this one (e.g. because they register a service it uses). */
  readonly dependsOn?: readonly string[];
  activate(context: ShellContext): void | Promise<void>;
}

export interface ShellContext {
  readonly apiVersion: number;
  readonly moduleId: string;
  /** Disposed when the module is deactivated: register every listener and contribution here. */
  readonly subscriptions: DisposableStore;
  readonly services: ServiceRegistry;
  readonly logger: ILogger;
}

export class ModuleHost implements IDisposable {
  private readonly active = new Map<string, DisposableStore>();

  constructor(
    private readonly services: ServiceRegistry,
    private readonly logger: ILogger,
  ) {}

  /**
   * Activates modules in dependency order. A module that throws is logged and skipped,
   * and so are the modules that depend on it; the rest of the shell keeps working.
   */
  async activateAll(modules: readonly ShellModule[]): Promise<void> {
    for (const module of orderByDependencies(modules)) {
      const missing = (module.dependsOn ?? []).filter((id) => !this.active.has(id));
      if (missing.length > 0) {
        this.logger.error(`module ${module.id} skipped: missing ${missing.join(', ')}`);
        continue;
      }
      const subscriptions = new DisposableStore();
      try {
        await module.activate({
          apiVersion: SHELL_API_VERSION,
          moduleId: module.id,
          subscriptions,
          services: this.services,
          logger: this.logger.child(module.id),
        });
        this.active.set(module.id, subscriptions);
      } catch (error) {
        subscriptions.dispose();
        this.logger.error(`module ${module.id} failed to activate`, error);
      }
    }
  }

  dispose(): void {
    for (const subscriptions of [...this.active.values()].reverse()) {
      subscriptions.dispose();
    }
    this.active.clear();
  }
}

/** Topological order; modules whose dependencies form a cycle or are unknown come last. */
export function orderByDependencies(modules: readonly ShellModule[]): ShellModule[] {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const ordered: ShellModule[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (module: ShellModule): void => {
    const current = state.get(module.id);
    if (current === 'done' || current === 'visiting') {
      return;
    }
    state.set(module.id, 'visiting');
    for (const dependency of module.dependsOn ?? []) {
      const found = byId.get(dependency);
      if (found) {
        visit(found);
      }
    }
    state.set(module.id, 'done');
    ordered.push(module);
  };
  modules.forEach(visit);
  return ordered;
}
