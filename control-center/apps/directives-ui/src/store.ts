import { DirectiveUiError } from "./errors.ts";
import type { Directive, ResourceId } from "./types.ts";

export class MemoryDirectiveStore {
  private readonly records = new Map<ResourceId, Directive>();

  constructor(seed: readonly Directive[] = []) {
    for (const record of seed) {
      this.records.set(record.id, cloneDirective(record));
    }
  }

  list(): Directive[] {
    return [...this.records.values()]
      .map(cloneDirective)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  }

  get(id: ResourceId): Directive | undefined {
    const found = this.records.get(id);
    return found ? cloneDirective(found) : undefined;
  }

  insert(record: Directive): void {
    if (this.records.has(record.id)) {
      throw new DirectiveUiError("duplicate_id", "directive id already exists", { id: record.id });
    }
    this.records.set(record.id, cloneDirective(record));
  }

  /**
   * Replace is only for explicit lifecycle (supersede marks the predecessor).
   * Callers must not use this to silently rewrite body/kind.
   */
  replace(record: Directive): void {
    if (!this.records.has(record.id)) {
      throw new DirectiveUiError("not_found", "directive does not exist", { id: record.id });
    }
    this.records.set(record.id, cloneDirective(record));
  }
}

function cloneDirective(record: Directive): Directive {
  return {
    ...record,
    created_by: { ...record.created_by },
    supersedes: record.supersedes ? [...record.supersedes] : null,
    audit: record.audit.map((entry) => ({
      ...entry,
      actor: { ...entry.actor },
    })),
    ...(record.tags ? { tags: [...record.tags] } : {}),
    ...(record.related_ids ? { related_ids: [...record.related_ids] } : {}),
  };
}
