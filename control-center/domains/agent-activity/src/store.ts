import type { AgentActivityRepository, LedgerRecord } from "./contract.js";

/**
 * In-process adapter. A later Postgres implementation must match get/put/list
 * plus append-only revisions already stored on each LedgerRecord.
 */
export class InMemoryAgentActivityStore implements AgentActivityRepository {
  private readonly records = new Map<string, LedgerRecord>();

  get(correlationId: string): LedgerRecord | undefined {
    const found = this.records.get(correlationId);
    return found === undefined ? undefined : clone(found);
  }

  put(record: LedgerRecord): void {
    this.records.set(record.correlation_id, clone(record));
  }

  list(): LedgerRecord[] {
    return [...this.records.values()]
      .sort((a, b) => a.correlation_id.localeCompare(b.correlation_id))
      .map((item) => clone(item));
  }

  clear(): void {
    this.records.clear();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
