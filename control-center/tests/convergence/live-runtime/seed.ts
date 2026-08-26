import type { Persistence } from "../../../persistence/src/index.js";
import type { ActorRef, ContextService } from "../../../services/context/src/index.ts";
import { representativeOperationalSnapshots } from "../../../services/context/src/operational/representative.ts";

export const LIVE_NOW = "2026-08-20T12:00:00.000Z";
export const LIVE_AS_OF = "2026-08-20T15:00:00.000Z";
export const FOUNDER: ActorRef = { kind: "human", id: "founder-local" };
export const AGENT: ActorRef = { kind: "agent", id: "agent-live-qa" };

const SOURCE = { system: "manual", kind: "directive", locator: "live-runtime-qa" };

function base(
  kind: string,
  title: string,
  body: string,
  scope: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind,
    title,
    body,
    scope,
    source: SOURCE,
    observed_at: LIVE_NOW,
    freshness_status: "FRESH",
    confidence: 1,
    ...extra,
  };
}

export interface SeededIds {
  founderDecisionId: string;
  supersededDecisionId: string;
  hypothesisId: string;
  errorRiskId: string;
  staleFactId: string;
  acmeFactId: string;
  siblingFactId: string;
  proposalId: string;
}

export function seedLiveCockpit(service: ContextService): SeededIds {
  const priority = service.createDirective(
    FOUNDER,
    base(
      "priority",
      "Close Diagnostico limited production",
      "The three things that matter now start with Diagnostico limited production readiness.",
      "company",
    ),
  );
  void priority;

  service.createDirective(
    FOUNDER,
    base(
      "risk",
      "Diagnostico limited production is still open",
      "The Diagnostico limited-production exception remains open and must stay visible on Hoje.",
      "company",
    ),
  );

  const founderDecision = service.createDirective(
    FOUNDER,
    base(
      "decision",
      "Governance is strategic authority",
      "Governance is the canonical strategic authority. Warmbly remains commercial CRM authority.",
      "company",
    ),
  );

  const oldPrice = service.createDirective(
    FOUNDER,
    base(
      "decision",
      "Diagnostico list price is 4900 BRL",
      "Original founder price decision.",
      "finance",
    ),
  );
  const newPrice = service.supersede(
    FOUNDER,
    oldPrice.id,
    base(
      "decision",
      "Diagnostico list price is 5900 BRL",
      "Founder superseded the prior price decision.",
      "finance",
    ),
  );
  void newPrice;

  const hypothesis = service.createDirective(
    FOUNDER,
    base(
      "hypothesis",
      "Pipeline may close this week",
      "This remains a hypothesis until a human promotes it.",
      "commercial",
    ),
  );

  const errorRisk = service.createDirective(
    FOUNDER,
    base(
      "risk",
      "PNCP collector returned a transport error",
      "Collection failed; freshness must stay ERROR and must not be painted healthy.",
      "infrastructure",
      { freshness_status: "ERROR", confidence: 0, observed_at: LIVE_NOW },
    ),
  );

  const staleFact = service.createDirective(
    FOUNDER,
    base(
      "fact",
      "Warmbly pipeline snapshot is stale",
      "Last successful commercial collect is outside the freshness window.",
      "commercial",
      {
        freshness_status: "STALE",
        observed_at: "2026-08-18T12:00:00.000Z",
        confidence: 0.4,
      },
    ),
  );

  service.createDirective(
    FOUNDER,
    base(
      "directive",
      "No financial-provider mutation from Control Center",
      "This wave does not charge, refund, cancel, or mutate Asaas.",
      "commercial",
    ),
  );

  service.createDirective(
    FOUNDER,
    base(
      "fact",
      "Receivables are integer cents in BRL",
      "Finance figures stay in integer cents plus currency.",
      "finance",
    ),
  );

  service.createDirective(
    FOUNDER,
    base(
      "fact",
      "Clients domain is an attention read model",
      "Client status is aggregated with provenance.",
      "clients",
    ),
  );

  const acme = service.createDirective(
    FOUNDER,
    base(
      "fact",
      "Acme diagnosis is in limited production",
      "Scoped to client acme. Sibling clients must not appear.",
      "client:acme",
    ),
  );

  const sibling = service.createDirective(
    FOUNDER,
    base(
      "fact",
      "Other client is a sibling and must not leak",
      "Scoped to client other.",
      "client:other",
    ),
  );

  service.createDirective(
    FOUNDER,
    base(
      "fact",
      "Governance repo is the canonical engineering surface",
      "Engineering signals are scoped per repository.",
      "repo:tjsasakifln/Governance",
    ),
  );

  service.createDirective(
    FOUNDER,
    base(
      "constraint",
      "External integrations are read-only by default",
      "Collectors must not mutate Asaas or send commercial communication.",
      "company",
    ),
  );

  const proposal = service.submitProposal(AGENT, {
    action: "create",
    kind: "hypothesis",
    title: "Maybe raise Diagnostico price",
    body: "Agent may only propose. This must not become a founder decision.",
    scope: "commercial",
    rationale: "price sensitivity research",
    source: { system: "agent", kind: "proposal", locator: "sess-live-qa" },
    observed_at: LIVE_NOW,
    freshness_status: "FRESH",
    confidence: 0.35,
  });

  return {
    founderDecisionId: founderDecision.id,
    supersededDecisionId: oldPrice.id,
    hypothesisId: hypothesis.id,
    errorRiskId: errorRisk.id,
    staleFactId: staleFact.id,
    acmeFactId: acme.id,
    siblingFactId: sibling.id,
    proposalId: proposal.id,
  };
}

export async function seedOperationalCockpit(persistence: Persistence): Promise<number> {
  let inserted = 0;
  for (const row of representativeOperationalSnapshots()) {
    const recorded = await persistence.recordSnapshot({
      scope: row.scope,
      snapshotKind: row.snapshot_kind,
      payload: row.payload,
      source: row.source,
      observedAt: new Date(row.observed_at),
      freshnessStatus: row.freshness_status,
      confidence: row.confidence,
    });
    if (recorded.inserted) {
      inserted += 1;
    }
  }
  await persistence.recordObservation({
    scope: "commercial",
    observationKind: "outbound-inventory",
    source: { system: "extra-cli", kind: "outbound-inventory", locator: "commercial-reservoir/current" },
    observedAt: new Date("2026-08-20T11:49:00.000Z"),
    freshnessStatus: "FRESH",
    confidence: 1,
    idempotencyKey: "extra-cli:outbound-inventory:extra-run-e2e-2026-08-20",
    collectorRunId: null,
    payload: {
      current_feed: "full-national-commercial-reservoir",
      current_run: "extra-run-e2e-2026-08-20",
      target_confirmed: 2500,
      recipient_attributed: 1800,
      eligible_current: 1400,
      ready_reservoir: 1200,
      feed_age_seconds: 240,
      replenishment_state: "WAITING_FOR_EXTRA_CLI_REFRESH",
      queue_fill_blocker: "WAITING_FOR_ELIGIBLE_BATCH",
      funnel_rows: [
        { key: "target_confirmed", count: 2500 },
        { key: "identity_safe", count: 1800 },
        { key: "warmbly_eligible", count: 1400 },
        { key: "email_send_ready", count: 1200 },
      ],
    },
  });
  return inserted;
}
