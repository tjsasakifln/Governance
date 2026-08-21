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
  readiness?: { status?: string };
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
  confenge_intel_scoreboard?: Record<string, unknown>;
  confenge_intel_executive?: Record<string, unknown>;
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
