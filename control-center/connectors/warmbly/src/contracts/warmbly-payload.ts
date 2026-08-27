/** Warmbly-shaped runtime payload (synthetic fixtures or live HTTP bodies). */

export type WarmblyPagination = {
  total?: number | null;
  next_cursor?: string | null;
  has_more?: boolean;
};

export type WarmblyPipelineStage = {
  id: string;
  pipeline_id?: string;
  name: string;
  color?: string;
  position?: number;
  deal_count?: number;
  created_at?: string;
  updated_at?: string;
};

export type WarmblyPipeline = {
  id: string;
  name: string;
  position?: number;
  stages?: WarmblyPipelineStage[];
  created_at?: string;
  updated_at?: string;
};

export type WarmblyDeal = {
  id: string;
  pipeline_id?: string;
  stage_id?: string;
  contact_id?: string | null;
  account_id?: string | null;
  lead_id?: string | null;
  name: string;
  value?: number | null;
  currency?: string;
  status: string;
  expected_close_date?: string | null;
  won_at?: string | null;
  lost_at?: string | null;
  lost_reason?: string | null;
  assigned_to?: string | null;
  campaign_id?: string | null;
  created_at: string;
  updated_at: string;
  stage?: WarmblyPipelineStage;
};

export type WarmblyDealsSummary = {
  total?: number;
  open_count?: number;
  open_value?: number;
  won_count?: number;
  won_value?: number;
  lost_count?: number;
  lost_value?: number;
  currency?: string;
  mixed_currency?: boolean;
};

export type WarmblyTask = {
  id: string;
  contact_id?: string | null;
  deal_id?: string | null;
  assigned_to?: string | null;
  title: string;
  description?: string | null;
  due_date?: string | null;
  priority?: string;
  type?: string;
  status: string;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type WarmblyTasksSummary = {
  total?: number;
  pending_count?: number;
  in_progress_count?: number;
  completed_count?: number;
  cancelled_count?: number;
  overdue_count?: number;
  high_priority_count?: number;
};

export type WarmblyContact = {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  company?: string;
  phone?: string;
  subscribed?: boolean;
  verification_status?: string;
  account_id?: string | null;
  lead_id?: string | null;
  campaign_lead?: {
    status: string;
    last_activity_at?: string | null;
  } | null;
  created_at: string;
  updated_at: string;
};

export type WarmblyCampaign = {
  id: string;
  name: string;
  status: string;
  guardrail_tripped_at?: string | null;
  guardrail_reason?: string;
  created_at?: string;
  updated_at?: string;
};

export type WarmblyCampaignsOverview = {
  total?: number;
  active?: number;
  paused?: number;
  draft?: number;
  completed?: number;
};

export type WarmblyUniboxOverview = {
  total?: number;
  unread?: number;
  today?: number;
  week?: number;
  snoozed?: number;
  awaiting_reply?: number;
  awaiting_agent_draft?: number;
  scheduled_pending?: number;
  generated_at?: string;
};

export type WarmblyConfengeStatus = {
  enabled?: boolean;
  auto_send_enabled?: boolean;
  kill_switch?: boolean;
  sending_allowed?: boolean;
  feed_configured?: boolean;
  ops_health?: { status?: string };
  readiness?: {
    status?: string;
    pilot_cohort_state?: string;
    pilot_cohort_prepared?: number;
    pilot_cohort_needs_review?: number;
    pilot_cohort_approved?: number;
    pilot_cohort_sent?: number;
    latest_bounded_cohort?: {
      authorization_id?: string;
      cohort_id?: string;
      cohort_hash?: string;
      policy_version?: string;
      allowed_route_classes?: string[];
      route_class_distribution?: Record<string, number>;
      authorized_quantity?: number;
      max_daily_volume?: number;
      authorized_at?: string;
      expires_at?: string;
      state?: string;
      go_review_verdict?: string;
      go_review_at?: string;
      sent?: number;
      reserved?: number;
    };
  };
};

export type WarmblyOpsHealth = {
  computed_at?: string;
  lead_persisted?: boolean;
  alerts?: Array<{ id?: string; status?: string }>;
  slos?: Array<{ id?: string; status?: string }>;
  health_matrix?: { status?: string };
  matrix?: { status?: string };
};

export type WarmblyAttentionItem = {
  account_id: string;
  company_name: string;
  contact_name?: string;
  commercial_state?: string;
  queue_state?: string;
  suggested_action?: string;
  confidence?: number;
  intent?: string;
  updated_at: string;
  do_not_contact?: boolean;
  blocked?: boolean;
};

export type WarmblyActionCard = {
  action_id: string;
  company?: string;
  person?: string;
  why_now?: string;
  recommended_action?: string;
  next_action_at?: string;
  lane?: string;
  state?: string;
  actionable?: boolean;
  confidence?: string;
};

export type WarmblyTodayView = {
  summary?: { total?: number; calls?: number; emails_to_review?: number };
  actions?: WarmblyActionCard[];
};

export type WarmblyInboundItem = {
  lead_id: string;
  company?: string;
  person?: string;
  status?: string;
  why_now?: string;
  recommended_action?: string;
  next_action?: string;
  freshness?: string;
  confidence?: string;
  lead_age_seconds?: number;
  account_id?: string;
};

export type WarmblyList<T> = {
  data: T[];
  pagination?: WarmblyPagination;
};

export type EndpointFailure = {
  method: string;
  path: string;
  status: number;
  reason: string;
};

export type WarmblyHealth = {
  status?: string;
  version?: string;
};

/**
 * GET /v1/confenge/dispatch/status. Mirrors `dispatch.Status` in warmbly
 * (internal/app/confenge/dispatch/types.go). Every field is optional: this
 * connector must never turn a missing field into a confident reading of the
 * kill switch — an absent `paused` is UNKNOWN, never "active".
 */
export type WarmblyDispatchStatus = {
  paused?: boolean;
  pause_reason?: string;
  paused_by?: string | null;
  paused_at?: string | null;
  pause_source?: string | null;
  kill_switch?: boolean;
  in_send_window?: boolean;
  timezone?: string;
  window_start?: string;
  window_end?: string;
  next_slot_at?: string;
  sent_last_hour?: number;
  cap?: number;
  queued_approved?: number;
  min_gap_seconds?: number;
  active_leases?: number;
};

/**
 * GET /v1/confenge/first-touch/status. This is an audit/read model only: the
 * connector never evaluates the policy and never infers an approval locally.
 */
export type WarmblyDelegatedFirstTouchItem = {
  batch_id?: string;
  account_id?: string;
  cnpj14?: string;
  supplier_cnpj14?: string;
  buyer_cnpj14?: string;
  recipient?: string;
  route_class?: string;
  decision?: string;
  approval_source?: string;
  state?: string;
  evidence_reference?: string;
  evidence_hash?: string;
  source_run_id?: string;
  source_snapshot_hash?: string;
  reason_codes?: string[];
  blocker_codes?: string[];
  content_hash?: string;
  runtime_release_sha?: string;
  due_at?: string | null;
  readback_at?: string | null;
  decided_at?: string;
};

/**
 * `control.source` describes the authoritative feed run behind the control block.
 * `target_membership_count` is only a count of the confirmed target when
 * `target_membership_complete` is true — an incomplete membership reporting 0 means
 * "not reconciled yet", never "zero targets".
 */
export type WarmblyDelegatedFirstTouchControlSource = {
  run_id?: string;
  snapshot_hash?: string;
  freshness_state?: string;
  generated_at?: string | null;
  expires_at?: string | null;
  target_membership_complete?: boolean;
  target_membership_count?: number;
  supplier_confirmed_count?: number;
};

/**
 * Additive blocks of schema `warmbly.confenge.first-touch-control.v1`, forwarded verbatim
 * by the collector. Absent on older Warmbly releases, so every field stays optional.
 */
export type WarmblyDelegatedFirstTouchControl = {
  prepared?: number;
  ready_reservoir?: number;
  delegated_approved?: number;
  human_approved?: number;
  queued?: number;
  reserved?: number;
  next_due_at?: string | null;
  furthest_due_at?: string | null;
  capacity?: number;
  blocker?: string;
  source?: WarmblyDelegatedFirstTouchControlSource;
};

export type WarmblyDelegatedFirstTouchRunway = {
  ready_reservoir_count?: number;
  min_ready_reservoir?: number;
  queued_count?: number;
  reserved_count?: number;
  runway_hours?: number;
  runway_days?: number;
  mailbox_count?: number;
  daily_capacity?: number;
  stale_retired?: number;
  capacity_blocked?: boolean;
  capacity_blocker?: string;
};

export type WarmblyDelegatedFirstTouchStatus = {
  batch_id?: string;
  policy_id?: string;
  policy_version?: string;
  policy_hash?: string;
  policy_active?: boolean;
  executor?: string;
  counts?: Record<string, number>;
  human_approved?: number;
  queued_readback?: number;
  commercial_authority?: {
    source_run_id?: string;
    snapshot_id?: string;
    membership_hash?: string;
    validated_at?: string | null;
    valid_until?: string | null;
    state?: string;
  };
  duplicate_live_account?: number;
  duplicate_live_root?: number;
  runway?: WarmblyDelegatedFirstTouchRunway;
  control?: WarmblyDelegatedFirstTouchControl;
  items?: WarmblyDelegatedFirstTouchItem[];
};

/**
 * GET /v1/confenge/working-overview. Warmbly owns these aggregate queue lanes.
 * `theoretical_slots_24h` is deliberately kept distinct from observed future
 * slots: the Control Center must never use planning theory as runway capacity.
 */
export type WarmblyWorkingOverview = {
  reservoir_monitored?: number;
  actionable_now?: number;
  needs_contact?: number;
  needs_review?: number;
  approved_scheduled?: number;
  watch_awaiting?: number;
  suppressed?: number;
  stale_context?: number;
  due_next_24h?: number;
  theoretical_slots_24h?: number;
  capacity_load?: number;
  dynamic_priority_enabled?: boolean;
  last_feed_sync_at?: string | null;
  feed_age_seconds?: number | null;
  /** Additive producer facts. Absent on older Warmbly releases. */
  prepared?: number;
  slots_next_24h?: number;
  slots_next_7d?: number;
  replenishment_state?: string;
  stale_retired?: number;
  queue_fill_blocker?: string;
};

export type WarmblyObservedText = {
  availability?: "OBSERVED" | "UNKNOWN";
  value?: string;
  observed_at?: string;
};

export type WarmblyObservedMoney = WarmblyObservedText & {
  id?: string;
  status?: string;
  amount_cents?: number;
  currency?: string;
};

export type WarmblyWeeklyRevenueChain = {
  schema_version?: string;
  canonical_identity?: {
    correlation_id?: string;
    account_id?: string;
    opportunity_id?: string;
    offer_id?: string;
    proposal_id?: string;
    charge_id?: string;
    payment_id?: string;
  };
  latest_deliverable?: WarmblyObservedText;
  latest_evidence?: WarmblyObservedText;
  decision?: WarmblyObservedText;
  responsible?: WarmblyObservedText;
  deadline?: WarmblyObservedText;
  next_action?: WarmblyObservedText;
  proposal?: WarmblyObservedText;
  charge?: WarmblyObservedMoney;
  receipt?: WarmblyObservedMoney;
  held?: boolean;
  synthetic?: boolean;
};

export type WarmblyIntelExecutive = Record<string, unknown> & {
  schema_version?: string;
  month?: string;
  include_synthetic?: boolean;
  causal_proof?: boolean;
  real_empty?: boolean;
  weekly_revenue_chains?: WarmblyWeeklyRevenueChain[];
};

export type WarmblyPayload = {
  health?: WarmblyHealth;
  api_version?: string;
  pipelines?: WarmblyPipeline[] | WarmblyList<WarmblyPipeline>;
  deals?: WarmblyDeal[] | WarmblyList<WarmblyDeal>;
  deals_summary?: WarmblyDealsSummary;
  tasks?: WarmblyTask[] | WarmblyList<WarmblyTask>;
  tasks_search?: WarmblyTask[] | WarmblyList<WarmblyTask>;
  tasks_summary?: WarmblyTasksSummary;
  contacts?: WarmblyContact[] | WarmblyList<WarmblyContact>;
  campaigns?: WarmblyCampaign[] | WarmblyList<WarmblyCampaign>;
  campaigns_overview?: WarmblyCampaignsOverview;
  unibox_overview?: WarmblyUniboxOverview;
  confenge_status?: WarmblyConfengeStatus;
  confenge_ops_health?: WarmblyOpsHealth | { data: WarmblyOpsHealth };
  confenge_attention?: WarmblyAttentionItem[] | WarmblyList<WarmblyAttentionItem>;
  confenge_today?: WarmblyTodayView | { data: WarmblyTodayView };
  confenge_inbound?: WarmblyInboundItem[] | WarmblyList<WarmblyInboundItem>;
  confenge_dispatch_status?: WarmblyDispatchStatus | { data: WarmblyDispatchStatus };
  confenge_first_touch_status?: WarmblyDelegatedFirstTouchStatus | { data: WarmblyDelegatedFirstTouchStatus };
  confenge_working_overview?: WarmblyWorkingOverview | { data: WarmblyWorkingOverview };
  confenge_intel_scoreboard?: Record<string, unknown>;
  confenge_intel_executive?: WarmblyIntelExecutive;
  confenge_intel_report?: Record<string, unknown>;
  confenge_intel_exceptions?: unknown;
  confenge_intel_organic_scoreboard?: Record<string, unknown>;
  unavailable?: EndpointFailure[];
};

export function unwrapList<T>(value: T[] | WarmblyList<T> | undefined): T[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return Array.isArray(value.data) ? value.data : [];
}

export function unwrapData<T>(value: T | { data: T } | undefined): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "object" && value !== null && "data" in value) {
    return (value as { data: T }).data;
  }
  return value;
}
