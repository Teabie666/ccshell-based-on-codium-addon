/**
 * A minimal service registry. Shell modules talk to each other only through services
 * registered here (by typed id), never by importing each other, so modules can be added,
 * removed or (later) loaded from plugins without touching the rest of the shell.
 */

import type { IDisposable } from '../platform/lifecycle';

export interface ServiceId<T> {
  readonly name: string;
  /** Phantom field that carries the service type; never set at runtime. */
  readonly __type?: T;
}

export function createServiceId<T>(name: string): ServiceId<T> {
  return { name };
}

export class ServiceRegistry {
  private readonly services = new Map<ServiceId<unknown>, unknown>();

  register<T>(id: ServiceId<T>, instance: T): IDisposable {
    if (this.services.has(id)) {
      throw new Error(`service ${id.name} registered twice`);
    }
    this.services.set(id, instance);
    return { dispose: () => this.services.delete(id) };
  }

  get<T>(id: ServiceId<T>): T {
    if (!this.services.has(id)) {
      throw new Error(`service ${id.name} is not registered`);
    }
    return this.services.get(id) as T;
  }

  tryGet<T>(id: ServiceId<T>): T | undefined {
    return this.services.get(id) as T | undefined;
  }
}
