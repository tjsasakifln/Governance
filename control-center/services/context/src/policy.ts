import type { DirectiveKind, DirectiveRecord, DirectiveStatus, ProtectedKind } from "./types.ts";
import { PROTECTED_KINDS } from "./types.ts";
import { parseUtcIso } from "./clock.ts";

export function isProtectedKind(kind: DirectiveKind): kind is ProtectedKind {
  return (PROTECTED_KINDS as readonly string[]).includes(kind);
}

export function isActiveAt(record: DirectiveRecord, now: Date): boolean {
  if (record.status !== "active") {
    return false;
  }
  const effective = parseUtcIso(record.effective_from, "effective_from");
  if (effective.getTime() > now.getTime()) {
    return false;
  }
  if (record.expires_at !== null) {
    const expires = parseUtcIso(record.expires_at, "expires_at");
    if (expires.getTime() <= now.getTime()) {
      return false;
    }
  }
  return true;
}

const KIND_ORDER: Record<DirectiveKind, number> = {
  constraint: 0,
  decision: 1,
  directive: 2,
  fact: 3,
  priority: 4,
  risk: 5,
  hypothesis: 6,
};

export function compareDirectives(a: DirectiveRecord, b: DirectiveRecord): number {
  const kind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (kind !== 0) {
    return kind;
  }
  const id = a.id.localeCompare(b.id);
  if (id !== 0) {
    return id;
  }
  return a.revision_id.localeCompare(b.revision_id);
}

export function partitionByKind(records: readonly DirectiveRecord[]): {
  decisions: DirectiveRecord[];
  facts: DirectiveRecord[];
  constraints: DirectiveRecord[];
  priorities: DirectiveRecord[];
  risks: DirectiveRecord[];
  directives: DirectiveRecord[];
  hypotheses: DirectiveRecord[];
} {
  const out = {
    decisions: [] as DirectiveRecord[],
    facts: [] as DirectiveRecord[],
    constraints: [] as DirectiveRecord[],
    priorities: [] as DirectiveRecord[],
    risks: [] as DirectiveRecord[],
    directives: [] as DirectiveRecord[],
    hypotheses: [] as DirectiveRecord[],
  };
  for (const rec of records) {
    switch (rec.kind) {
      case "decision":
        out.decisions.push(rec);
        break;
      case "fact":
        out.facts.push(rec);
        break;
      case "constraint":
        out.constraints.push(rec);
        break;
      case "priority":
        out.priorities.push(rec);
        break;
      case "risk":
        out.risks.push(rec);
        break;
      case "directive":
        out.directives.push(rec);
        break;
      case "hypothesis":
        out.hypotheses.push(rec);
        break;
    }
  }
  return out;
}

export function terminalStatus(status: DirectiveStatus): boolean {
  return status === "superseded" || status === "expired";
}
