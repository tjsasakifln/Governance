import type {
  AttentionItem,
  ClientStatus,
  DueCommitmentItem,
  HomepageAttention,
  OpenBlockerItem,
} from "./contract.js";
import {
  classifyCommitment,
  isMaterialRisk,
  isOpenBlocker,
  riskWeight,
} from "./health.js";
import { matchesScope, parseScope } from "./scope.js";
import { assertQueryHorizonHours } from "./validate.js";

export const DEFAULT_DUE_HORIZON_HOURS = 7 * 24;

export interface QueryInput {
  now: Date;
  records: readonly ClientStatus[];
  scope?: string;
  horizonHours?: number;
}

/**
 * Clients that need the operator now, each with why + next action.
 * Homepage contract: "qual cliente precisa de mim agora e por quê?"
 */
export function queryAttention(input: QueryInput): AttentionItem[] {
  const scope = parseScope(input.scope);
  const items: AttentionItem[] = [];
  for (const record of input.records) {
    if (!matchesScope(record.client_slug, scope)) {
      continue;
    }
    if (!requiresAttention(record, input.now)) {
      continue;
    }
    const why = record.health.reasons.map((reason) => reason.message);
    items.push({
      client_slug: record.client_slug,
      display_name: record.display_name,
      scope: record.scope,
      why,
      next_action: record.next_action,
      health_score: record.health.score,
      health_band: record.health.band,
      reasons: record.health.reasons,
      urgency: urgencyOf(record, input.now),
    });
  }
  items.sort((a, b) => b.urgency - a.urgency || a.client_slug.localeCompare(b.client_slug));
  return items;
}

export function queryDueCommitments(input: QueryInput): DueCommitmentItem[] {
  const scope = parseScope(input.scope);
  const horizonHours = input.horizonHours ?? DEFAULT_DUE_HORIZON_HOURS;
  assertQueryHorizonHours(horizonHours);
  const horizonMs = input.now.getTime() + horizonHours * 60 * 60 * 1000;
  const items: DueCommitmentItem[] = [];
  for (const record of input.records) {
    if (!matchesScope(record.client_slug, scope)) {
      continue;
    }
    for (const commitment of record.commitments) {
      const klass = classifyCommitment(commitment, input.now);
      if (klass === "closed") {
        continue;
      }
      const dueMs = Date.parse(commitment.due_at);
      if (dueMs > horizonMs) {
        continue;
      }
      items.push({
        client_slug: record.client_slug,
        display_name: record.display_name,
        commitment,
        overdue: klass === "overdue",
      });
    }
  }
  items.sort(
    (a, b) =>
      a.commitment.due_at.localeCompare(b.commitment.due_at) ||
      a.client_slug.localeCompare(b.client_slug) ||
      a.commitment.id.localeCompare(b.commitment.id),
  );
  return items;
}

export function queryOpenBlockers(input: QueryInput): OpenBlockerItem[] {
  const scope = parseScope(input.scope);
  const items: OpenBlockerItem[] = [];
  for (const record of input.records) {
    if (!matchesScope(record.client_slug, scope)) {
      continue;
    }
    for (const blocker of record.blockers) {
      if (!isOpenBlocker(blocker)) {
        continue;
      }
      items.push({
        client_slug: record.client_slug,
        display_name: record.display_name,
        blocker,
      });
    }
  }
  items.sort(
    (a, b) => a.client_slug.localeCompare(b.client_slug) || a.blocker.id.localeCompare(b.blocker.id),
  );
  return items;
}

export function toHomepageAttention(item: AttentionItem): HomepageAttention {
  return {
    client_slug: item.client_slug,
    display_name: item.display_name,
    why: item.why,
    next_action_summary: item.next_action?.summary ?? "",
  };
}

export function requiresAttention(record: ClientStatus, now: Date): boolean {
  const overdue = record.commitments.some((item) => classifyCommitment(item, now) === "overdue");
  const dueSoon = record.commitments.some((item) => classifyCommitment(item, now) === "due_soon");
  const openBlocker = record.blockers.some(isOpenBlocker);
  const materialRisk = record.risk.some(isMaterialRisk);
  const bandNeeds = record.health.band === "attention" || record.health.band === "critical";
  return overdue || dueSoon || openBlocker || materialRisk || bandNeeds;
}

function urgencyOf(record: ClientStatus, now: Date): number {
  let urgency = 100 - record.health.score;
  for (const commitment of record.commitments) {
    const klass = classifyCommitment(commitment, now);
    if (klass === "overdue") {
      urgency += 100;
    } else if (klass === "due_soon") {
      urgency += 25;
    }
  }
  for (const blocker of record.blockers) {
    if (isOpenBlocker(blocker)) {
      urgency += 50;
    }
  }
  for (const risk of record.risk) {
    if (risk.status === "open") {
      urgency += riskWeight(risk.severity);
    }
  }
  return urgency;
}
