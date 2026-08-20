import { parseUtcDateTime, toUtcDateTime } from "./datetime.ts";
import { DirectiveUiError } from "./errors.ts";
import { isScope } from "./contract.ts";
import { observeDirective } from "./observe.ts";
import type {
  AgentScopePreview,
  Clock,
  Directive,
  ObservedDirective,
  Scope,
} from "./types.ts";

export function isEffectiveAt(record: Directive, now: Date): boolean {
  if (record.status !== "active") return false;
  const effective = parseUtcDateTime(record.effective_from, "effective_from");
  if (effective.getTime() > now.getTime()) return false;
  if (record.expires_at !== null) {
    const expires = parseUtcDateTime(record.expires_at, "expires_at");
    if (expires.getTime() <= now.getTime()) return false;
  }
  return true;
}

export function previewTitle(scope: Scope): string {
  return `contexto que um agente verá para scope ${scope}`;
}

/**
 * Exact-scope preview. v1 string scopes have no ancestor inheritance in this UI.
 * Hypotheses are never mixed into decisions/facts. Other company memory is excluded.
 */
export function previewAgentContext(
  records: readonly Directive[],
  scope: string,
  clock: Clock,
): AgentScopePreview {
  if (!isScope(scope)) {
    throw new DirectiveUiError("invalid_scope", "preview requires a v1 scope string");
  }
  const now = clock.now();
  const asOf = toUtcDateTime(now);
  let excludedOther = 0;
  let excludedInactive = 0;
  const inScope: Directive[] = [];
  for (const record of records) {
    if (record.scope !== scope) {
      excludedOther += 1;
      continue;
    }
    if (!isEffectiveAt(record, now)) {
      excludedInactive += 1;
      continue;
    }
    inScope.push(record);
  }

  const bucket = {
    decisions: [] as ObservedDirective[],
    directives: [] as ObservedDirective[],
    facts: [] as ObservedDirective[],
    constraints: [] as ObservedDirective[],
    priorities: [] as ObservedDirective[],
    risks: [] as ObservedDirective[],
    hypotheses: [] as ObservedDirective[],
  };
  for (const record of inScope) {
    const observed = observeDirective(record, asOf);
    switch (record.kind) {
      case "decision":
        bucket.decisions.push(observed);
        break;
      case "directive":
        bucket.directives.push(observed);
        break;
      case "fact":
        bucket.facts.push(observed);
        break;
      case "constraint":
        bucket.constraints.push(observed);
        break;
      case "priority":
        bucket.priorities.push(observed);
        break;
      case "risk":
        bucket.risks.push(observed);
        break;
      case "hypothesis":
        bucket.hypotheses.push(observed);
        break;
    }
  }

  return {
    title: previewTitle(scope),
    scope,
    as_of: asOf,
    granted_scopes: [scope],
    ...bucket,
    excluded_other_scopes: excludedOther,
    excluded_inactive: excludedInactive,
  };
}

export function previewHasHypothesisMixedIntoAuthoritative(preview: AgentScopePreview): boolean {
  const authoritative = [
    ...preview.decisions,
    ...preview.directives,
    ...preview.facts,
    ...preview.constraints,
  ];
  return authoritative.some((item) => item.record.kind === "hypothesis");
}
