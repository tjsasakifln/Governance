export type TruthFreshness = "FRESH" | "STALE" | "UNKNOWN" | "ERROR";

export interface MorningSource {
  system: string;
  kind: string;
  locator: string;
  as_of: string | null;
  freshness: TruthFreshness;
}

export interface MorningException {
  id: string;
  bucket:
    | "identity_recipient_conflict"
    | "stale_drift"
    | "party_role_conflict"
    | "outbound_reply_handoff"
    | "payment_provider_ambiguity"
    | "capacity_unknown"
    | "delivery_blocker"
    | "runtime_mismatch"
    | "other";
  owner: string;
  reason: string;
  evidence: string[];
  age_seconds: number | null;
  next_action: string;
  severity: "critical" | "high" | "medium" | "low";
  source: MorningSource;
}

export interface FounderOperatingTruth {
  generated_at: string | null;
  outbound: {
    state: "ACTIVE" | "PAUSED" | "UNKNOWN";
    policy_version: string | null;
    source_run: string | null;
    queued: number | null;
    next_due: string | null;
    sends_today: number | null;
    limit: number | null;
    replies: number | null;
    bounces: number | null;
    opt_outs: number | null;
    exceptions: number | null;
    transport_health: string | null;
    source: MorningSource;
  };
  data: {
    current_feed: string | null;
    current_run: string | null;
    target_coverage: string | null;
    blocker: string | null;
    source: MorningSource;
  };
  inbound_web: {
    deploy_identity: string | null;
    lead_sla_state: string | null;
    gsc_readiness: string | null;
    public_surface_health: string | null;
    source: MorningSource;
  };
  delivery_finance: {
    active_work_orders: number | null;
    policy_ceiling: number | null;
    staffed_capacity: number | null;
    staffed_capacity_state: "KNOWN" | "UNKNOWN";
    committed: number | null;
    available: number | null;
    capacity_freshness: TruthFreshness;
    admission: "CAN_ACCEPT" | "CANNOT_ACCEPT" | "UNKNOWN";
    checkout_gate: "OPEN" | "BLOCKED" | "UNKNOWN";
    asaas_gate: "PROVEN" | "MISSING" | "BLOCKED" | "UNKNOWN";
    exceptions: number | null;
    source: MorningSource;
  };
  exceptions: MorningException[];
  primary_action: {
    owner: string;
    label: string;
    reason: string;
    href: string;
  } | null;
}

const O = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const A = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(O) : [];
const S = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const N = (value: unknown): number | null => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
const F = (value: unknown): TruthFreshness => value === "FRESH" || value === "STALE" || value === "ERROR" ? value : "UNKNOWN";
const BUCKETS = new Set<MorningException["bucket"]>(["identity_recipient_conflict", "stale_drift", "party_role_conflict", "outbound_reply_handoff", "payment_provider_ambiguity", "capacity_unknown", "delivery_blocker", "runtime_mismatch", "other"]);

function source(slot: Record<string, unknown>, system: string, kind?: string, locator?: string): MorningSource {
  const raw = O(slot.source);
  return { system: S(raw.system) ?? system, kind: kind ?? S(raw.kind) ?? "read-model", locator: locator ?? S(raw.locator) ?? "unobserved", as_of: S(slot.observed_at), freshness: F(slot.freshness_status) };
}

function exception(row: Record<string, unknown>, generatedAt: string | null): MorningException {
  const rawBucket = S(row.bucket) ?? S(row.kind) ?? "other";
  const bucket = BUCKETS.has(rawBucket as MorningException["bucket"]) ? rawBucket as MorningException["bucket"] : "other";
  const rawSource = O(row.source);
  const evidence = Array.isArray(row.evidence) ? row.evidence.filter((item): item is string => Boolean(S(item))) : [];
  const severity = row.severity === "critical" || row.severity === "high" || row.severity === "low" ? row.severity : "medium";
  return {
    id: S(row.exception_id) ?? S(row.id) ?? `projection-${bucket}`,
    bucket,
    owner: S(row.owner) ?? "UNKNOWN",
    reason: S(row.reason) ?? "Motivo não informado pela origem.",
    evidence: evidence.length ? evidence : ["evidence:UNKNOWN"],
    age_seconds: N(row.age_seconds),
    next_action: S(row.next_action) ?? "Confirmar owner, evidência e próxima ação na origem canônica.",
    severity,
    source: { system: S(rawSource.system) ?? "warmbly", kind: S(rawSource.kind) ?? "exception-read", locator: S(rawSource.locator) ?? S(row.id) ?? "unobserved", as_of: S(row.observed_at) ?? generatedAt, freshness: F(row.freshness ?? row.freshness_status) },
  };
}

export function projectFounderOperatingTruth(envelopeValue: unknown): FounderOperatingTruth {
  const envelope = O(envelopeValue), generatedAt = S(envelope.generated_at), snapshots = O(envelope.snapshots);
  const commercialSlot = O(snapshots.commercial), operations = O(O(commercialSlot.snapshot).operations);
  const dispatch = O(operations.dispatch), delegated = O(operations.delegated_first_touch), overview = O(operations.overview), outcomes = O(operations.outbound_outcomes);
  const delegatedItems = A(delegated.items), rawDispatchState = S(dispatch.state);
  const outboundState = dispatch.observed === true && (rawDispatchState === "ACTIVE" || rawDispatchState === "PAUSED") ? rawDispatchState : "UNKNOWN";
  const sourceRuns = [...new Set(delegatedItems.map((item) => S(item.source_run_id)).filter((item): item is string => Boolean(item)))];
  const dueDates = [...delegatedItems.filter((item) => item.state === "QUEUED").map((item) => S(item.due_at)), S(dispatch.next_slot_at)]
    .filter((item): item is string => typeof item === "string" && !Number.isNaN(Date.parse(item))).sort();
  const pncpSlot = O(snapshots.pncp), pncp = O(pncpSlot.snapshot), target = O(pncp.target_coverage);
  const targetCoverageText = N(target.covered) !== null && N(target.total) !== null ? `${N(target.covered)}/${N(target.total)}` : S(pncp.target_coverage);
  const webObservation = A(envelope.source_observations).filter((item) => ["web-cfg", "gsc"].includes(S(O(item.source).system) ?? "")).sort((left, right) => Date.parse(S(right.observed_at) ?? "") - Date.parse(S(left.observed_at) ?? ""))[0] ?? {};
  const webPayload = O(webObservation.payload), inbound = O(operations.inbound), delivery = O(operations.delivery), capacity = O(operations.capacity), governance = O(operations.governance);
  const financeSlot = O(snapshots.finance), finance = O(financeSlot.snapshot);
  const staffedState = capacity.staffed_capacity_state === "KNOWN" ? "KNOWN" : "UNKNOWN";
  const admission = capacity.admission === "CAN_ACCEPT" || capacity.admission === "CANNOT_ACCEPT"
    ? capacity.admission
    : "UNKNOWN";
  const checkoutGate = governance.checkout_gate === "OPEN" || governance.checkout_gate === "BLOCKED"
    ? governance.checkout_gate
    : "UNKNOWN";
  const asaasGate = governance.asaas_gate === "PROVEN" || governance.asaas_gate === "MISSING" || governance.asaas_gate === "BLOCKED"
    ? governance.asaas_gate
    : "UNKNOWN";

  const exceptions = A(operations.exceptions).map((item) => exception(item, generatedAt));
  if (!exceptions.some((item) => item.bucket === "capacity_unknown") && staffedState === "UNKNOWN") {
    exceptions.push({
      id: "projection-capacity-unknown",
      bucket: "capacity_unknown",
      owner: "delivery_owner",
      reason: "Capacidade staffed real não foi observada; policy ceiling não é disponibilidade.",
      evidence: [S(capacity.source_ref) ?? "capacity_snapshot:UNKNOWN"],
      age_seconds: null,
      next_action: "Publicar snapshot staffed real, calendário e WIP; manter admission/checkout fail-closed.",
      severity: "critical",
      source: {
        system: "governance",
        kind: "capacity-read-model",
        locator: S(capacity.source_ref) ?? "delivery/capacity",
        as_of: S(capacity.projected_at) ?? generatedAt,
        freshness: F(capacity.freshness),
      },
    });
  }
  if (!exceptions.some((item) => item.bucket === "payment_provider_ambiguity") && asaasGate !== "PROVEN") {
    exceptions.push({
      id: "projection-provider-unknown",
      bucket: "payment_provider_ambiguity",
      owner: "finance",
      reason: "Objetos/mapping Asaas não foram comprovados; PAYMENT_CONFIRMED não é receita recebida.",
      evidence: [S(governance.authority_ref) ?? "asaas_mapping:UNKNOWN"],
      age_seconds: null,
      next_action: "Reconciliar objetos/eventos no provider em sessão humana autorizada; não simular nem habilitar checkout.",
      severity: "critical",
      source: {
        ...source(financeSlot, "asaas"),
        kind: "provider-read",
        locator: "finance/provider-gate",
      },
    });
  }

  const explicitToday = A(envelope.today)[0];
  const capacityException = exceptions.find((item) => item.bucket === "capacity_unknown");
  const primaryAction = explicitToday
    ? {
        owner: S(explicitToday.owner) ?? "founder",
        label: S(explicitToday.recommended_action) ?? S(explicitToday.title) ?? "Tratar a prioridade operacional observada.",
        reason: S(explicitToday.reason) ?? "Prioridade publicada pela fila canônica de hoje.",
        href: "#/hoje",
      }
    : capacityException
      ? {
          owner: capacityException.owner,
          label: capacityException.next_action,
          reason: capacityException.reason,
          href: "#/comercial/excecoes?tipo=capacity_unknown",
        }
      : null;

  return {
    generated_at: generatedAt,
    outbound: {
      state: outboundState,
      policy_version: S(delegated.policy_version), source_run: sourceRuns.length === 1 ? sourceRuns[0]! : S(delegated.source_run_id),
      queued: N(delegated.queued_readback) ?? N(dispatch.queued_approved), next_due: dueDates[0] ?? null,
      sends_today: N(dispatch.sent_today), limit: N(dispatch.daily_limit) ?? N(dispatch.cap), replies: N(outcomes.replies) ?? N(overview.replies), bounces: N(outcomes.bounces) ?? N(overview.bounces), opt_outs: N(outcomes.opt_outs) ?? N(overview.opt_outs), exceptions: N(overview.exceptions), transport_health: S(dispatch.transport_health), source: source(commercialSlot, "warmbly"),
    },
    data: {
      current_feed: S(pncp.current_feed) ?? S(pncp.feed_id),
      current_run: S(pncp.current_run) ?? S(pncp.run_id) ?? S(pncp.source_run_id),
      target_coverage: targetCoverageText,
      blocker: S(pncp.blocker) ?? (pncpSlot.presence === "absent" ? S(pncpSlot.absence_reason) : null), source: source(pncpSlot, "extra-cli/pncp"),
    },
    inbound_web: {
      deploy_identity: S(webPayload.deploy_identity) ?? S(webPayload.release_sha) ?? S(webPayload.commit_sha), lead_sla_state: S(inbound.lead_sla_state) ?? S(webPayload.lead_sla_state), gsc_readiness: S(webPayload.gsc_readiness), public_surface_health: S(webPayload.public_surface_health), source: source(webObservation, "web-cfg"),
    },
    delivery_finance: {
      active_work_orders: N(delivery.active_work_orders), policy_ceiling: N(capacity.policy_ceiling), staffed_capacity: staffedState === "KNOWN" ? N(capacity.staffed_capacity) : null,
      staffed_capacity_state: staffedState,
      committed: staffedState === "KNOWN" ? N(capacity.committed) : null, available: staffedState === "KNOWN" ? N(capacity.available) : null, capacity_freshness: F(capacity.freshness),
      admission: staffedState === "KNOWN" ? admission : "UNKNOWN",
      checkout_gate: checkoutGate,
      asaas_gate: asaasGate,
      exceptions: N(delivery.exceptions) ?? N(finance.exception_count), source: source(financeSlot, "asaas/governance"),
    },
    exceptions,
    primary_action: primaryAction,
  };
}
