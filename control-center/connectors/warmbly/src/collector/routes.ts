/**
 * Mapped Warmbly commercial-read routes (discovered from the fork, not invented).
 *
 * Prefer GET list when it exists. Contacts have no GET list — POST /search
 * is the documented read. Deal/task POST /search and /summary are read queries.
 */

export type CollectRoute = {
  key: keyof import("../contracts/warmbly-payload.ts").WarmblyPayload;
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
  required: boolean;
};

export const COLLECT_ROUTES: CollectRoute[] = [
  { key: "health", method: "GET", path: "/health", required: true },
  { key: "pipelines", method: "GET", path: "/v1/crm/pipelines", required: true },
  { key: "deals", method: "GET", path: "/v1/crm/deals?limit=100", required: true },
  {
    key: "deals_summary",
    method: "POST",
    path: "/v1/crm/deals/summary",
    body: {},
    required: false,
  },
  { key: "tasks", method: "GET", path: "/v1/crm/tasks?limit=100", required: true },
  {
    key: "tasks_search",
    method: "POST",
    path: "/v1/crm/tasks/search",
    body: { overdue: true, statuses: ["pending", "in_progress"] },
    required: false,
  },
  { key: "contacts", method: "POST", path: "/v1/contacts/search", body: {}, required: true },
  // List is currently 500 on production Warmbly; campaigns-overview is the working read.
  { key: "campaigns", method: "GET", path: "/v1/campaigns?limit=100", required: false },
  { key: "campaigns_overview", method: "GET", path: "/v1/campaigns-overview", required: false },
  { key: "unibox_overview", method: "GET", path: "/v1/unibox/overview", required: false },
  { key: "confenge_status", method: "GET", path: "/v1/confenge/status", required: false },
  { key: "confenge_ops_health", method: "GET", path: "/v1/confenge/ops/health", required: false },
  {
    key: "confenge_attention",
    method: "GET",
    path: "/v1/confenge/attention?filter=needs_attention&limit=50",
    required: false,
  },
  { key: "confenge_today", method: "GET", path: "/v1/confenge/today", required: false },
  { key: "confenge_inbound", method: "GET", path: "/v1/confenge/inbound", required: false },
  // The kill-switch state the operator cockpit reads back. Not required: an
  // older Warmbly answers 404 and the surface must say UNKNOWN, never "active".
  {
    key: "confenge_dispatch_status",
    method: "GET",
    path: "/v1/confenge/dispatch/status",
    required: false,
  },
  {
    key: "confenge_intel_scoreboard",
    method: "GET",
    path: "/v1/confenge/intel/scoreboard?include_synthetic=0",
    required: false,
  },
  {
    key: "confenge_intel_executive",
    method: "GET",
    path: "/v1/confenge/intel/executive?include_synthetic=0",
    required: false,
  },
  {
    key: "confenge_intel_exceptions",
    method: "GET",
    path: "/v1/confenge/intel/exceptions",
    required: false,
  },
  {
    key: "confenge_intel_organic_scoreboard",
    method: "GET",
    path: "/v1/confenge/intel/organic-scoreboard",
    required: false,
  },
];

export const MAPPED_READ_ROUTES = COLLECT_ROUTES.map((r) => `${r.method} ${r.path.split("?")[0]}`);
