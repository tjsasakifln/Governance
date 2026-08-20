import {
  SOURCE_DERIVED_HEALTH,
  type AccountHealth,
  type Blocker,
  type ClientLifecycle,
  type Commitment,
  type CommitmentStatus,
  type Deliverable,
  type HealthBand,
  type HealthReason,
  type Risk,
  type RiskSeverity,
} from "./contract.js";
import { toUtcIso } from "./clock.js";

export const DUE_SOON_HOURS = 48;

export const HEALTH_DELTAS = {
  overdue_commitment: 20,
  due_soon_commitment: 8,
  open_blocker: 15,
  blocked_deliverable: 10,
  risk: {
    low: 3,
    medium: 8,
    high: 15,
    critical: 25,
  },
} as const;

const CLOSED_COMMITMENT = new Set<CommitmentStatus>(["done", "cancelled"]);

export type CommitmentClass = "closed" | "overdue" | "due_soon" | "upcoming";

export function classifyCommitment(commitment: Commitment, now: Date): CommitmentClass {
  if (CLOSED_COMMITMENT.has(commitment.status)) {
    return "closed";
  }
  const dueMs = Date.parse(commitment.due_at);
  const nowMs = now.getTime();
  if (dueMs < nowMs) {
    return "overdue";
  }
  if (dueMs - nowMs <= DUE_SOON_HOURS * 60 * 60 * 1000) {
    return "due_soon";
  }
  return "upcoming";
}

export function isOpenBlocker(blocker: Blocker): boolean {
  return blocker.status === "open";
}

export function isOpenRisk(risk: Risk): boolean {
  return risk.status === "open";
}

export function isBlockedDeliverable(deliverable: Deliverable): boolean {
  return deliverable.status === "blocked";
}

export function isMaterialRisk(risk: Risk): boolean {
  return isOpenRisk(risk) && risk.severity !== "low";
}

/**
 * Deterministic, explainable, rule-based account health. No ML.
 * Same inputs + clock always produce the same score and reason set.
 */
export function scoreAccountHealth(
  input: {
    commitments: readonly Commitment[];
    blockers: readonly Blocker[];
    risk: readonly Risk[];
    deliverables: readonly Deliverable[];
  },
  now: Date,
): AccountHealth {
  let score = 100;
  const reasons: HealthReason[] = [];

  const commitments = sortById(input.commitments);
  const blockers = sortById(input.blockers);
  const risks = sortById(input.risk);
  const deliverables = sortById(input.deliverables);

  for (const commitment of commitments) {
    const klass = classifyCommitment(commitment, now);
    if (klass === "overdue") {
      score -= HEALTH_DELTAS.overdue_commitment;
      reasons.push({
        code: "overdue_commitment",
        delta: HEALTH_DELTAS.overdue_commitment,
        message: `Compromisso vencido: ${commitment.title}`,
        related_id: commitment.id,
      });
    } else if (klass === "due_soon") {
      score -= HEALTH_DELTAS.due_soon_commitment;
      reasons.push({
        code: "due_soon_commitment",
        delta: HEALTH_DELTAS.due_soon_commitment,
        message: `Compromisso vencendo: ${commitment.title}`,
        related_id: commitment.id,
      });
    }
  }

  for (const blocker of blockers) {
    if (!isOpenBlocker(blocker)) {
      continue;
    }
    score -= HEALTH_DELTAS.open_blocker;
    reasons.push({
      code: "open_blocker",
      delta: HEALTH_DELTAS.open_blocker,
      message: `Bloqueio aberto: ${blocker.title}`,
      related_id: blocker.id,
    });
  }

  for (const risk of risks) {
    if (!isOpenRisk(risk)) {
      continue;
    }
    const delta = HEALTH_DELTAS.risk[risk.severity];
    score -= delta;
    reasons.push({
      code: "open_risk",
      delta,
      message: `Risco aberto (${risk.severity}): ${risk.title}`,
      related_id: risk.id,
    });
  }

  for (const deliverable of deliverables) {
    if (!isBlockedDeliverable(deliverable)) {
      continue;
    }
    score -= HEALTH_DELTAS.blocked_deliverable;
    reasons.push({
      code: "blocked_deliverable",
      delta: HEALTH_DELTAS.blocked_deliverable,
      message: `Entrega bloqueada: ${deliverable.title}`,
      related_id: deliverable.id,
    });
  }

  reasons.sort(compareReasons);
  const clamped = clampScore(score);

  return {
    score: clamped,
    band: bandFor(clamped),
    reasons,
    provenance: {
      source: SOURCE_DERIVED_HEALTH,
      observed_at: toUtcIso(now),
      freshness_status: "fresh",
    },
  };
}

export function bandFor(score: number): HealthBand {
  if (score >= 80) {
    return "healthy";
  }
  if (score >= 60) {
    return "watch";
  }
  if (score >= 40) {
    return "attention";
  }
  return "critical";
}

export function lifecycleFromHealth(
  health: AccountHealth,
  risks: readonly Risk[],
): ClientLifecycle {
  const openCritical = risks.some((risk) => isOpenRisk(risk) && risk.severity === "critical");
  if (openCritical || health.band === "critical") {
    return "churn_risk";
  }
  return "active";
}

export function compareReasons(a: HealthReason, b: HealthReason): number {
  if (a.code !== b.code) {
    return a.code.localeCompare(b.code);
  }
  return (a.related_id ?? "").localeCompare(b.related_id ?? "");
}

function clampScore(score: number): number {
  if (score < 0) {
    return 0;
  }
  if (score > 100) {
    return 100;
  }
  return score;
}

function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

export function riskWeight(severity: RiskSeverity): number {
  switch (severity) {
    case "critical":
      return 80;
    case "high":
      return 40;
    case "medium":
      return 15;
    case "low":
      return 5;
    default: {
      const _exhaustive: never = severity;
      return _exhaustive;
    }
  }
}
