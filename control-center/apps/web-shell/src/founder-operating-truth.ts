export type TruthFreshness = "FRESH" | "STALE" | "UNKNOWN" | "ERROR";
export type SourceHealthState = "FRESH" | "DEGRADED" | "STALE" | "UNKNOWN";
export type CommercialAuthorityState = "CURRENT" | "DEGRADED" | "FROZEN" | "EXPIRED" | "UNKNOWN";



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
  reason_group?: string;
  owner: string;
  reason: string;
  evidence: string[];
  age_seconds: number | null;
  next_action: string;
  severity: "critical" | "high" | "medium" | "low";
  source: MorningSource;
}

export type TransportDecision = "GO" | "PAUSED" | "NO_GO" | "UNKNOWN";

export interface MorningFact<T extends string | number> {
  value: T | null;
  source: MorningSource;
  href: string;
}

export interface OutboundRunwayTruth {
  transport: {
    state: MorningFact<TransportDecision>;
    runtime_sha: MorningFact<string>;
    policy_version: MorningFact<string>;
    source_health: MorningFact<SourceHealthState>;
    commercial_state: MorningFact<CommercialAuthorityState>;
    commercial_until: MorningFact<string>;
    pause: MorningFact<string>;
    kill_switch: MorningFact<string>;
  };
  stock: {
    target_confirmed: MorningFact<number>;
    recipient_attributed: MorningFact<number>;
    eligible_current: MorningFact<number>;
    prepared: MorningFact<number>;
    delegated_approved: MorningFact<number>;
    human_approved: MorningFact<number>;
    queued_reserved: MorningFact<number>;
    hold_exceptions: MorningFact<number>;
    sent: MorningFact<number>;
    attempted: MorningFact<number>;
    provider_accepted: MorningFact<number>;
    delivered: MorningFact<number>;
    replies: MorningFact<number>;
    suppressed: MorningFact<number>;
  };
  runway: {
    current_queued: MorningFact<number>;
    furthest_due_at: MorningFact<string>;
    estimated_days: MorningFact<number>;
    slots_next_24h: MorningFact<number>;
    slots_next_7d: MorningFact<number>;
    ready_reservoir: MorningFact<number>;
    source_feed_age_seconds: MorningFact<number>;
    next_replenishment_state: MorningFact<string>;
    reservoir_below_1000: boolean | null;
  };
  health: {
    mailboxes_healthy: MorningFact<number>;
    mailboxes_blocked: MorningFact<number>;
    mailboxes_unknown: MorningFact<number>;
    provider_errors: MorningFact<number>;
    bounces: MorningFact<number>;
    complaints: MorningFact<number>;
    stale_retired: MorningFact<number>;
    queue_fill_blocker: MorningFact<string>;
  };
  integrity: {
    state: "OK" | "UNKNOWN" | "ERROR";
    source_run_match: "MATCH" | "MISMATCH" | "UNKNOWN";
    reason_codes: string[];
  };
}

export interface FounderOperatingTruth {
  generated_at: string | null;
  outbound_runway: OutboundRunwayTruth;
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
    request: string;
    deadline_risk: "FEASIBLE" | "INFEASIBLE" | "UNKNOWN";
    blockers: string[];
    next_action: string | null;
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

const EXTRA_DRILLDOWN = "#/crescimento";
const WARMBLY_DRILLDOWN = "#/warmbly/revisao";
const TRANSPORT_DRILLDOWN = "#/warmbly/operacao";

function sourceWithFreshness(value: MorningSource, freshness: TruthFreshness): MorningSource {
  return { ...value, freshness };
}

function countFact(
  value: number | null,
  factSource: MorningSource,
  href: string,
): MorningFact<number> {
  return {
    value: factSource.freshness === "FRESH" ? value : null,
    source: factSource,
    href,
  };
}

function textFact<T extends string>(
  value: T | null,
  factSource: MorningSource,
  href: string,
): MorningFact<T> {
  return { value, source: factSource, href };
}

function newestObservation(
  rows: Record<string, unknown>[],
  predicate: (row: Record<string, unknown>) => boolean,
): Record<string, unknown> {
  return rows.filter(predicate).sort((left, right) => Date.parse(S(right.observed_at) ?? "") - Date.parse(S(left.observed_at) ?? ""))[0] ?? {};
}

function countFromFunnel(rows: Record<string, unknown>[], key: string): number | null {
  return N(rows.find((row) => S(row.key) === key)?.count);
}

function stateCount(counts: Record<string, unknown>, keys: readonly string[]): number | null {
  if (Object.keys(counts).length === 0) return null;
  return keys.reduce((total, key) => total + (N(counts[key]) ?? 0), 0);
}

function validDate(value: unknown): string | null {
  const raw = S(value);
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

function oldestAsOf(...values: Array<string | null>): string | null {
  return values.filter((item): item is string => Boolean(item)).sort()[0] ?? null;
}

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
  const code0 = Array.isArray(row.reason_codes) && typeof row.reason_codes[0] === "string" ? row.reason_codes[0] : null;
  const group = S(row.reason_group) ?? (code0 === "MEMBERSHIP_LEAVE_PROVEN" ? "MEMBERSHIP_DRIFT" : code0);
  return {
    id: S(row.exception_id) ?? S(row.id) ?? `projection-${bucket}`,
    bucket,
    ...(group ? { reason_group: group } : {}),
    owner: S(row.owner) ?? "UNKNOWN",
    reason: S(row.reason) ?? "Motivo ausente.",
    evidence: evidence.length ? evidence : ["evidence:UNKNOWN"],
    age_seconds: N(row.age_seconds),
    next_action: S(row.next_action) ?? "Confirmar owner e evidência na origem.",
    severity,
    source: { system: S(rawSource.system) ?? "warmbly", kind: S(rawSource.kind) ?? "exception-read", locator: S(rawSource.locator) ?? S(row.id) ?? "unobserved", as_of: S(row.observed_at) ?? generatedAt, freshness: F(row.freshness ?? row.freshness_status) },
  };
}

export function projectFounderOperatingTruth(envelopeValue: unknown): FounderOperatingTruth {
  const envelope = O(envelopeValue), generatedAt = S(envelope.generated_at), snapshots = O(envelope.snapshots);
  const observations = A(envelope.source_observations);
  const commercialSlot = O(snapshots.commercial), operations = O(O(commercialSlot.snapshot).operations);
  const dispatch = O(operations.dispatch), delegated = O(operations.delegated_first_touch), working = O(operations.working_overview);
  const overview = O(operations.overview), outcomes = O(operations.outbound_outcomes), mailboxHealth = O(operations.mailbox_health);
  const delegatedItems = A(delegated.items), delegatedCounts = O(delegated.counts), rawDispatchState = S(dispatch.state);
  const warmblySource = source(commercialSlot, "warmbly", "outbound-read-model", "commercial/operations");

  const pncpSlot = O(snapshots.pncp), pncp = O(pncpSlot.snapshot), target = O(pncp.target_coverage);
  const extraObservation = newestObservation(observations, (item) => {
    const system = S(O(item.source).system) ?? "";
    const payload = O(item.payload);
    return system === "extra-cli" && (Array.isArray(payload.funnel_rows) || Object.keys(O(payload.outbound_inventory)).length > 0 || N(payload.target_confirmed) !== null);
  });
  const extraPayload = O(extraObservation.payload);
  const inventory = Object.keys(O(extraPayload.outbound_inventory)).length > 0 ? O(extraPayload.outbound_inventory) : extraPayload;
  const pncpInventory = Object.keys(O(pncp.outbound_inventory)).length > 0 ? O(pncp.outbound_inventory) : pncp;
  const inventoryValue = (key: string): unknown => Object.hasOwn(inventory, key) ? inventory[key] : pncpInventory[key];
  const reservoir = Object.keys(O(inventory.reservoir_health)).length > 0 ? O(inventory.reservoir_health) : O(pncpInventory.reservoir_health);
  const funnelRows = A(inventory.funnel_rows).length > 0 ? A(inventory.funnel_rows) : A(pncpInventory.funnel_rows);
  const extraSource = Object.keys(extraObservation).length > 0
    ? source(extraObservation, "extra-cli", "outbound-inventory", "commercial-reservoir/current")
    : source(pncpSlot, "extra-cli");
  const currentFeed = S(inventoryValue("current_feed")) ?? S(inventoryValue("feed_id"));
  const currentRun = S(inventoryValue("current_run")) ?? S(inventoryValue("run_id")) ?? S(inventoryValue("source_run_id"));
  const targetCoverageText = N(target.covered) !== null && N(target.total) !== null ? `${N(target.covered)}/${N(target.total)}` : S(pncp.target_coverage);

  const transportRaw = S(dispatch.transport_state) ?? rawDispatchState;
  const reportedTransportDecision: TransportDecision = transportRaw === "GO" || transportRaw === "NO_GO" || transportRaw === "PAUSED"
    ? transportRaw
    : transportRaw === "ACTIVE" ? "GO" : "UNKNOWN";
  const transportDecision: TransportDecision = warmblySource.freshness === "FRESH" ? reportedTransportDecision : "UNKNOWN";
  const outboundState: FounderOperatingTruth["outbound"]["state"] = transportDecision === "GO" ? "ACTIVE" : transportDecision === "PAUSED" || transportDecision === "NO_GO" ? "PAUSED" : "UNKNOWN";
  const sourceRuns = [...new Set(delegatedItems.map((item) => S(item.source_run_id)).filter((item): item is string => Boolean(item)))];
  const delegatedRun = sourceRuns.length === 1 ? sourceRuns[0]! : sourceRuns.length === 0 ? S(delegated.source_run_id) : null;
  const sourceRunMatch: OutboundRunwayTruth["integrity"]["source_run_match"] = sourceRuns.length > 1
    ? "MISMATCH"
    : currentRun && delegatedRun ? currentRun === delegatedRun ? "MATCH" : "MISMATCH" : "UNKNOWN";
  const dueDates = delegatedItems
    .filter((item) => item.state === "QUEUED")
    .map((item) => validDate(item.due_at))
    .filter((item): item is string => Boolean(item))
    .sort();
  const furthestDueDates = [
    ...dueDates,
    validDate(working.furthest_due_at),
    validDate(delegated.furthest_due_at),
    validDate(dispatch.furthest_due_at),
  ].filter((item): item is string => Boolean(item)).sort();
  const nextDueDates = [...dueDates, validDate(dispatch.next_slot_at)].filter((item): item is string => Boolean(item)).sort();
  const runtimeShas = [...new Set([
    ...delegatedItems.map((item) => S(item.runtime_release_sha)),
    S(delegated.runtime_release_sha),
  ].filter((item): item is string => Boolean(item)))];

  // Warmbly's first-touch control block (schema warmbly.confenge.first-touch-control.v1) is
  // forwarded verbatim by the connector, so `control` and `runway` reach this projection intact.
  // Fallback only: extra-cli stays the authority, and a Warmbly number is adopted solely when
  // extra-cli produced nothing. A stale or errored Warmbly reading is never adopted — the same gate
  // the transport decision already applies. This carries the two headline numbers that were
  // permanently UNKNOWN ("Leads prontos" and the derived "Munição estimada").
  //
  // Deliberately NOT extended to target_confirmed, recipient_attributed or eligible_current:
  // nothing in the control block counts identity attribution or current eligibility, and
  // target_membership_count is a membership denominator, not the funnel stage this row reports.
  // Inventing those mappings would publish numbers nobody observed.
  const delegatedControl = O(delegated.control);
  const extraReadyReservoir = N(inventoryValue("ready_reservoir")) ?? N(inventoryValue("email_send_ready_reservoir")) ?? N(reservoir.email_send_ready_reservoir) ?? N(inventoryValue("email_send_ready")) ?? countFromFunnel(funnelRows, "email_send_ready");
  const warmblyReadyReservoir = extraReadyReservoir === null && warmblySource.freshness === "FRESH"
    ? N(delegatedControl.ready_reservoir) ?? N(O(delegated.runway).ready_reservoir_count)
    : null;
  const readyReservoirFromWarmbly = warmblyReadyReservoir !== null;
  const readyReservoir = extraReadyReservoir ?? warmblyReadyReservoir;
  const targetConfirmed = N(inventoryValue("target_confirmed")) ?? N(reservoir.TARGET_CONFIRMED) ?? countFromFunnel(funnelRows, "target_confirmed");
  const recipientAttributed = N(inventoryValue("recipient_attributed")) ?? N(inventoryValue("identity_safe")) ?? countFromFunnel(funnelRows, "identity_safe");
  const eligibleCurrent = N(inventoryValue("eligible_current")) ?? N(inventoryValue("warmbly_eligible")) ?? countFromFunnel(funnelRows, "warmbly_eligible");
  const prepared = N(working.prepared) ?? N(delegated.prepared) ?? stateCount(delegatedCounts, ["PREPARED", "POLICY_EVALUATED", "APPROVED", "APPROVED_NOT_SCHEDULED", "QUEUED", "SENT", "HOLD", "NEEDS_REVIEW", "EXCEPTION"]);
  const delegatedApproved = N(delegated.delegated_approved) ?? stateCount(delegatedCounts, ["APPROVED", "APPROVED_NOT_SCHEDULED", "QUEUED", "SENT"]);
  const humanApproved = N(delegated.human_approved);
  const queued = N(delegated.queued_readback);
  const holdExceptions = N(delegated.hold_exceptions) ?? stateCount(delegatedCounts, ["HOLD", "NEEDS_REVIEW", "EXCEPTION"]) ?? N(overview.outbound_exceptions);
  const sent = N(outcomes.sent) ?? (Object.hasOwn(delegatedCounts, "SENT") ? N(delegatedCounts.SENT) : null);
  const attempted = N(outcomes.attempted);
  const providerAccepted = N(outcomes.provider_accepted);
  const delivered = N(outcomes.delivered);
  const replies = N(outcomes.replies) ?? N(overview.replies);
  const suppressed = N(outcomes.suppressed) ?? N(working.suppressed);
  const rawSlots24h = N(working.slots_next_24h) ?? N(dispatch.slots_next_24h);
  const rawSlots7d = N(working.slots_next_7d) ?? N(dispatch.slots_next_7d);
  const feedAge = N(working.feed_age_seconds) ?? N(inventoryValue("feed_age_seconds"));
  const feedAgeSource = N(working.feed_age_seconds) !== null ? warmblySource : extraSource;
  const replenishmentState = S(working.replenishment_state) ?? S(inventoryValue("replenishment_state"));
  const replenishmentSource = S(working.replenishment_state) ? warmblySource : extraSource;
  const queueFillBlocker = S(working.queue_fill_blocker) ?? S(inventoryValue("queue_fill_blocker")) ?? S(pncp.blocker);
  const queueFillSource = S(working.queue_fill_blocker) ? warmblySource : extraSource;

  const authorityBlock = O(delegated.commercial_authority);
  const csRaw = S(authorityBlock.state);
  const cs = csRaw && csRaw.includes("FROZEN") ? "FROZEN" : csRaw;
  const validatedAt = validDate(authorityBlock.validated_at);
  const originMs = Date.parse(generatedAt ?? "");
  const ageSec = validatedAt && originMs ? Math.floor((originMs - Date.parse(validatedAt)) / 1000) : null;
  const fromAge: CommercialAuthorityState = ageSec === null || ageSec < 0 ? "UNKNOWN" : ageSec <= 86400 ? "CURRENT" : ageSec <= 259200 ? "DEGRADED" : ageSec <= 604800 ? "FROZEN" : "EXPIRED";
  const commercialState: CommercialAuthorityState = cs === "CURRENT" || cs === "DEGRADED" || cs === "FROZEN" || cs === "EXPIRED" ? cs : fromAge;
  const extraFeedAge = N(inventoryValue("feed_age_seconds"));
  const sourceHealthState: SourceHealthState = extraFeedAge !== null && extraFeedAge >= 0 ? extraFeedAge <= 86400 ? "FRESH" : extraFeedAge <= 259200 ? "DEGRADED" : "STALE" : extraSource.freshness === "ERROR" ? "UNKNOWN" : extraSource.freshness;
  const pause = [S(dispatch.pause_reason), S(dispatch.paused_by), S(dispatch.pause_source), validDate(dispatch.paused_at)].map((v) => v ?? "UNKNOWN").join(" · ");
  const killRaw = overview.kill_switch ?? dispatch.kill_switch ?? O(operations.confenge_status).kill_switch;
  const kill = typeof killRaw === "boolean" ? (killRaw ? "ativo" : "desligado") : "UNKNOWN";

  const integrityReasons: string[] = [];
  if (sourceRunMatch === "MISMATCH") integrityReasons.push("SOURCE_RUN_CHANGED");
  if (runtimeShas.length > 1) integrityReasons.push("RUNTIME_SHA_MISMATCH");
  const impossible = (code: string, part: number | null, whole: number | null): void => {
    if (part !== null && whole !== null && part > whole) integrityReasons.push(code);
  };
  impossible("RECIPIENT_ATTRIBUTED_GT_TARGET_CONFIRMED", recipientAttributed, targetConfirmed);
  impossible("ELIGIBLE_CURRENT_GT_RECIPIENT_ATTRIBUTED", eligibleCurrent, recipientAttributed);
  impossible("READY_RESERVOIR_GT_ELIGIBLE_CURRENT", readyReservoir, eligibleCurrent);
  impossible("PREPARED_GT_ELIGIBLE_CURRENT", prepared, eligibleCurrent);
  impossible("DELEGATED_APPROVED_GT_PREPARED", delegatedApproved, prepared);
  impossible("HUMAN_APPROVED_GT_PREPARED", humanApproved, prepared);
  impossible("QUEUED_GT_DELEGATED_APPROVED", queued, delegatedApproved);
  impossible("SENT_GT_ATTEMPTED", sent, attempted);
  impossible("PROVIDER_ACCEPTED_GT_ATTEMPTED", providerAccepted, attempted);
  impossible("DELIVERED_GT_PROVIDER_ACCEPTED", delivered, providerAccepted);
  impossible("REPLIES_GT_ATTEMPTED", replies, attempted);
  impossible("SUPPRESSED_GT_TARGET_CONFIRMED", suppressed, targetConfirmed);
  const hasImpossibleNumbers = integrityReasons.some((code) => code !== "SOURCE_RUN_CHANGED" && code !== "RUNTIME_SHA_MISMATCH");
  const reconciledWarmblySource = hasImpossibleNumbers
    ? sourceWithFreshness(warmblySource, "ERROR")
    : warmblySource;
  const reconciledExtraSource = hasImpossibleNumbers ? sourceWithFreshness(extraSource, "ERROR") : extraSource;

  // Provenance follows the value: a Warmbly-derived reservoir never claims the extra-cli locator,
  // and its drill-down has to land where the number actually lives. Sending the founder to the
  // extra-cli growth view for a count extra-cli never published would show an empty stage and read
  // as a contradiction of the tile above it.
  const readyReservoirSource = readyReservoirFromWarmbly ? reconciledWarmblySource : reconciledExtraSource;
  const readyReservoirHref = readyReservoirFromWarmbly
    ? `${WARMBLY_DRILLDOWN}?etapa=ready_reservoir`
    : `${EXTRA_DRILLDOWN}?etapa=ready_reservoir`;
  const targetFact = countFact(targetConfirmed, reconciledExtraSource, `${EXTRA_DRILLDOWN}?etapa=target_confirmed`);
  const recipientFact = countFact(recipientAttributed, reconciledExtraSource, `${EXTRA_DRILLDOWN}?etapa=recipient_attributed`);
  const eligibleFact = countFact(eligibleCurrent, reconciledExtraSource, `${EXTRA_DRILLDOWN}?etapa=eligible_current`);
  const preparedFact = countFact(prepared, reconciledWarmblySource, `${WARMBLY_DRILLDOWN}?filtro=prepared`);
  const approvedFact = countFact(delegatedApproved, reconciledWarmblySource, `${WARMBLY_DRILLDOWN}?filtro=delegated`);
  const humanApprovedFact = countFact(humanApproved, reconciledWarmblySource, `${WARMBLY_DRILLDOWN}?filtro=human_approved`);
  const queuedFact = countFact(queued, reconciledWarmblySource, `${WARMBLY_DRILLDOWN}?filtro=queued`);
  const holdFact = countFact(holdExceptions, reconciledWarmblySource, `${WARMBLY_DRILLDOWN}?filtro=exceptions`);
  const sentFact = countFact(sent, reconciledWarmblySource, `${WARMBLY_DRILLDOWN}?filtro=sent`);
  const attemptedFact = countFact(attempted, reconciledWarmblySource, `${WARMBLY_DRILLDOWN}?filtro=attempted`);
  const providerAcceptedFact = countFact(providerAccepted, reconciledWarmblySource, `${WARMBLY_DRILLDOWN}?filtro=provider_accepted`);
  const deliveredFact = countFact(delivered, reconciledWarmblySource, `${WARMBLY_DRILLDOWN}?filtro=delivered`);
  const repliesFact = countFact(replies, reconciledWarmblySource, `${WARMBLY_DRILLDOWN}?filtro=replies`);
  const suppressedFact = countFact(suppressed, reconciledWarmblySource, `${WARMBLY_DRILLDOWN}?filtro=suppressed`);
  const slots24Fact = countFact(rawSlots24h, warmblySource, TRANSPORT_DRILLDOWN);
  const slots7Fact = countFact(rawSlots7d, warmblySource, TRANSPORT_DRILLDOWN);
  const readyFact = countFact(readyReservoir, readyReservoirSource, readyReservoirHref);
  const runwayDays = sourceRunMatch === "MATCH" && readyFact.value !== null && slots7Fact.value !== null && slots7Fact.value > 0
    ? Math.round((readyFact.value * 7 / slots7Fact.value) * 10) / 10
    : null;
  const runwaySource: MorningSource = {
    system: readyReservoirFromWarmbly ? "warmbly" : "extra-cli+warmbly",
    kind: "derived-runway",
    locator: readyReservoirFromWarmbly ? warmblySource.locator : `${extraSource.locator} + ${warmblySource.locator}`,
    as_of: readyReservoirFromWarmbly ? warmblySource.as_of : oldestAsOf(extraSource.as_of, warmblySource.as_of),
    freshness: runwayDays === null ? "UNKNOWN" : "FRESH",
  };
  const runwayDaysFact = countFact(runwayDays, runwaySource, TRANSPORT_DRILLDOWN);

  const outboundRunway: OutboundRunwayTruth = {
    transport: {
      state: textFact(transportDecision, warmblySource, TRANSPORT_DRILLDOWN),
      runtime_sha: textFact(runtimeShas.length === 1 ? runtimeShas[0]! : null, runtimeShas.length > 1 ? sourceWithFreshness(warmblySource, "ERROR") : warmblySource, TRANSPORT_DRILLDOWN),
      policy_version: textFact(S(delegated.policy_version), warmblySource, `${WARMBLY_DRILLDOWN}?filtro=delegated`),
      source_health: textFact(sourceHealthState, extraSource, EXTRA_DRILLDOWN),
      commercial_state: textFact(commercialState, reconciledWarmblySource, `${WARMBLY_DRILLDOWN}?filtro=delegated`),
      commercial_until: textFact(validDate(authorityBlock.valid_until), reconciledWarmblySource, `${WARMBLY_DRILLDOWN}?filtro=delegated`),
      pause: textFact(pause, warmblySource, TRANSPORT_DRILLDOWN),
      kill_switch: textFact(kill, warmblySource, TRANSPORT_DRILLDOWN),
    },
    stock: {
      target_confirmed: targetFact,
      recipient_attributed: recipientFact,
      eligible_current: eligibleFact,
      prepared: preparedFact,
      delegated_approved: approvedFact,
      human_approved: humanApprovedFact,
      queued_reserved: queuedFact,
      hold_exceptions: holdFact,
      sent: sentFact,
      attempted: attemptedFact,
      provider_accepted: providerAcceptedFact,
      delivered: deliveredFact,
      replies: repliesFact,
      suppressed: suppressedFact,
    },
    runway: {
      current_queued: queuedFact,
      furthest_due_at: textFact(furthestDueDates.at(-1) ?? null, reconciledWarmblySource, `${WARMBLY_DRILLDOWN}?filtro=queued`),
      estimated_days: runwayDaysFact,
      slots_next_24h: slots24Fact,
      slots_next_7d: slots7Fact,
      ready_reservoir: readyFact,
      source_feed_age_seconds: countFact(feedAge, feedAgeSource, EXTRA_DRILLDOWN),
      next_replenishment_state: textFact(replenishmentState, replenishmentSource, EXTRA_DRILLDOWN),
      reservoir_below_1000: readyFact.value === null ? null : readyFact.value < 1000,
    },
    health: {
      mailboxes_healthy: countFact(N(mailboxHealth.healthy), warmblySource, TRANSPORT_DRILLDOWN),
      mailboxes_blocked: countFact(N(mailboxHealth.blocked), warmblySource, TRANSPORT_DRILLDOWN),
      mailboxes_unknown: countFact(N(mailboxHealth.unknown), warmblySource, TRANSPORT_DRILLDOWN),
      provider_errors: countFact(N(outcomes.provider_errors) ?? N(dispatch.provider_errors), warmblySource, TRANSPORT_DRILLDOWN),
      bounces: countFact(N(outcomes.bounces) ?? N(overview.bounces), warmblySource, `${WARMBLY_DRILLDOWN}?filtro=bounces`),
      complaints: countFact(N(outcomes.complaints), warmblySource, `${WARMBLY_DRILLDOWN}?filtro=complaints`),
      stale_retired: countFact(N(working.stale_retired), warmblySource, `${WARMBLY_DRILLDOWN}?filtro=stale_retired`),
      queue_fill_blocker: textFact(queueFillBlocker, queueFillSource, `${WARMBLY_DRILLDOWN}?filtro=exceptions`),
    },
    integrity: {
      state: hasImpossibleNumbers || runtimeShas.length > 1 ? "ERROR" : sourceRunMatch === "UNKNOWN" && commercialState === "UNKNOWN" ? "UNKNOWN" : "OK",
      source_run_match: sourceRunMatch,
      reason_codes: [...new Set(integrityReasons)],
    },
  };

  const webObservation = newestObservation(observations, (item) => ["web-cfg", "gsc"].includes(S(O(item.source).system) ?? ""));
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
  const deadlineRisk = capacity.deadline_risk === "FEASIBLE" || capacity.deadline_risk === "INFEASIBLE"
    ? capacity.deadline_risk
    : "UNKNOWN";
  const capacityBlockers = A(capacity.blockers).map((item) => S(item.next_action)).filter((item): item is string => Boolean(item));
  const capacityNextAction = S(capacity.next_action);

  const exceptions = A(operations.exceptions).map((item) => exception(item, generatedAt));
  if (commercialState === "EXPIRED" || commercialState === "FROZEN") {
    const expired = commercialState === "EXPIRED";
    const group = expired ? "COMMERCIAL_AUTHORITY_EXPIRED" : "COMMERCIAL_AUTHORITY_FROZEN";
    if (!exceptions.some((item) => item.reason_group === group)) {
      exceptions.push({
        id: "projection-commercial-authority",
        bucket: "stale_drift",
        reason_group: group,
        owner: "outbound_owner",
        reason: expired ? "Estoque expirado." : "Estoque congelado.",
        evidence: [`binding:${S(authorityBlock.source_run_id) ?? "UNKNOWN"}`],
        age_seconds: null,
        next_action: "Revalidar na origem.",
        severity: "high",
        source: reconciledWarmblySource,
      });
    }
  }
  const invalidatingIntegrity = hasImpossibleNumbers || runtimeShas.length > 1;
  if (invalidatingIntegrity && !exceptions.some((item) => item.id === "projection-outbound-integrity")) {
    exceptions.push({
      id: "projection-outbound-integrity",
      bucket: runtimeShas.length > 1 ? "runtime_mismatch" : "other",
      owner: "outbound_owner",
      reason: `Leitura outbound bloqueada por ${integrityReasons.filter((code) => code !== "SOURCE_RUN_CHANGED").join(", ")}.`,
      evidence: [`extra_run:${currentRun ?? "UNKNOWN"}`, `warmbly_run:${delegatedRun ?? "UNKNOWN"}`],
      age_seconds: null,
      next_action: "Reconciliar source run, runtime e denominadores.",
      severity: "critical",
      source: sourceWithFreshness(warmblySource, "ERROR"),
    });
  }
  if (!exceptions.some((item) => item.bucket === "capacity_unknown") && staffedState === "UNKNOWN") {
    exceptions.push({
      id: "projection-capacity-unknown",
      bucket: "capacity_unknown",
      owner: "delivery_owner",
      reason: "Capacidade staffed não observada; teto de política não é disponibilidade.",
      evidence: [S(capacity.source_ref) ?? "capacity_snapshot:UNKNOWN"],
      age_seconds: null,
      next_action: "Publicar snapshot staffed real e manter admissão fechada.",
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
      reason: "Asaas não comprovado; PAYMENT_CONFIRMED não é receita.",
      evidence: [S(governance.authority_ref) ?? "asaas_mapping:UNKNOWN"],
      age_seconds: null,
      next_action: "Reconciliar no provider; não habilitar checkout.",
      severity: "critical",
      source: {
        ...source(financeSlot, "asaas"),
        kind: "provider-read",
        locator: "finance/provider-gate",
      },
    });
  }

  const integrityException = exceptions.find((item) => item.id === "projection-outbound-integrity");
  const materialQueueBlocker = queueFillSource.freshness === "FRESH" && queueFillBlocker && !/^(?:NONE|NO_BLOCKER|UNKNOWN)$/i.test(queueFillBlocker) ? queueFillBlocker : null;
  const primaryAction = integrityException
    ? {
        owner: integrityException.owner,
        label: "Resolver divergência do outbound",
        reason: integrityException.reason,
        href: "#/comercial/excecoes?tipo=runtime_mismatch",
      }
    : materialQueueBlocker
      ? {
          owner: "outbound_owner",
          label: "Resolver blocker do refill",
          reason: materialQueueBlocker,
          href: "#/comercial/excecoes?tipo=queue_fill_blocker",
        }
      : holdFact.value !== null && holdFact.value > 0
        ? {
            owner: "outbound_owner",
            label: `Revisar ${holdFact.value} exceção(ões) outbound`,
            reason: "Somente HOLD, NEEDS_REVIEW e EXCEPTION; elegíveis seguem delegados.",
            href: "#/warmbly/revisao?filtro=exceptions",
          }
        : null;

  return {
    generated_at: generatedAt,
    outbound_runway: outboundRunway,
    outbound: {
      state: outboundState,
      policy_version: S(delegated.policy_version), source_run: delegatedRun,
      queued: queuedFact.value, next_due: nextDueDates[0] ?? null,
      sends_today: N(dispatch.sent_today), limit: N(dispatch.daily_limit) ?? N(dispatch.cap), replies: N(outcomes.replies) ?? N(overview.replies), bounces: N(outcomes.bounces) ?? N(overview.bounces), opt_outs: N(outcomes.opt_outs) ?? N(overview.opt_outs), exceptions: N(overview.exceptions), transport_health: S(dispatch.transport_health), source: source(commercialSlot, "warmbly"),
    },
    data: {
      current_feed: currentFeed,
      current_run: currentRun,
      target_coverage: targetCoverageText ?? (targetConfirmed === null ? null : String(targetConfirmed)),
      blocker: queueFillBlocker ?? (pncpSlot.presence === "absent" ? S(pncpSlot.absence_reason) : null), source: extraSource,
    },
    inbound_web: {
      deploy_identity: S(webPayload.deploy_identity) ?? S(webPayload.release_sha) ?? S(webPayload.commit_sha), lead_sla_state: S(inbound.lead_sla_state) ?? S(webPayload.lead_sla_state), gsc_readiness: S(webPayload.gsc_readiness), public_surface_health: S(webPayload.public_surface_health), source: source(webObservation, "web-cfg"),
    },
    delivery_finance: {
      active_work_orders: N(delivery.active_work_orders), policy_ceiling: N(capacity.policy_ceiling), staffed_capacity: staffedState === "KNOWN" ? N(capacity.staffed_capacity) : null,
      staffed_capacity_state: staffedState,
      committed: staffedState === "KNOWN" ? N(capacity.committed) : null,
      available: staffedState === "KNOWN" ? N(capacity.available) : null,
      capacity_freshness: F(capacity.freshness),
      admission: staffedState === "KNOWN" ? admission : "UNKNOWN",
      request: [capacity.deliverable_id, capacity.deliverable_version, capacity.requested_deadline]
        .map((value) => S(value) ?? "desconhecido").join(" / "),
      deadline_risk: deadlineRisk,
      blockers: capacityBlockers,
      next_action: capacityNextAction,
      checkout_gate: checkoutGate,
      asaas_gate: asaasGate,
      exceptions: N(delivery.exceptions) ?? N(finance.exception_count), source: source(financeSlot, "asaas/governance"),
    },
    exceptions,
    primary_action: primaryAction,
  };
}
