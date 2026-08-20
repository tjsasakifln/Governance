import type { ClientStatus } from "./contract.js";
import { matchesScope, parseScope, type ParsedScope } from "./scope.js";

/**
 * Persistence port. Postgres in `control-center/persistence` should implement
 * the same operations at convergence. This wave uses an in-process Map.
 */
export interface ClientStatusRepository {
  upsert(status: ClientStatus): void;
  getBySlug(clientSlug: string): ClientStatus | undefined;
  list(): ClientStatus[];
}

export class InMemoryClientStore implements ClientStatusRepository {
  private readonly records = new Map<string, ClientStatus>();

  upsert(status: ClientStatus): void {
    this.records.set(status.client_slug, clone(status));
  }

  getBySlug(clientSlug: string): ClientStatus | undefined {
    const found = this.records.get(clientSlug);
    return found === undefined ? undefined : clone(found);
  }

  list(): ClientStatus[] {
    return [...this.records.values()]
      .sort((a, b) => a.client_slug.localeCompare(b.client_slug))
      .map((item) => clone(item));
  }

  listScoped(scope: ParsedScope | string | undefined): ClientStatus[] {
    const parsed = typeof scope === "string" || scope === undefined ? parseScope(scope) : scope;
    return this.list().filter((item) => matchesScope(item.client_slug, parsed));
  }

  clear(): void {
    this.records.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
