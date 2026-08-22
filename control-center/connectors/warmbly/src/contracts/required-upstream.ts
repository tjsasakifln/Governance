import type { RequiredUpstreamContract } from "./snapshot.ts";

const AUTH_HEADERS = ["Authorization", "API-Version"];

/** Always-documented gap: Warmbly has no GET /leads. */
export const LEADS_LIST_CONTRACT: RequiredUpstreamContract = {
  id: "GET /v1/leads",
  method: "GET",
  path: "/v1/leads",
  reason:
    "Warmbly has no GET /leads. The connector maps POST /v1/contacts/search plus GET /v1/confenge/inbound (and accounts, when enabled) as the lead surface. A dedicated leads list is not required while those reads stay available.",
  min_request: {
    method: "GET",
    path: "/v1/leads",
    query: { limit: "100" },
    headers: AUTH_HEADERS,
  },
  min_response: {
    status: 200,
    body: {
      data: [
        {
          id: "uuid",
          company: "string",
          status: "string",
          created_at: "RFC3339 UTC",
          updated_at: "RFC3339 UTC",
        },
      ],
      pagination: { total: 0, has_more: false },
    },
  },
};

/**
 * Declared only when the summary says the open pipeline mixes currencies but
 * gives no per-currency breakdown.
 *
 * That is the shape the CONFENGE incident arrived in: an empty `deals[]` and a
 * summary-only reading. With no per-deal rows to group and no breakdown from
 * the summary, per-currency separation is not something the Control Center can
 * derive — and it will not convert. So the gap is named as an upstream
 * contract instead of being papered over with an invented total.
 */
export const DEALS_SUMMARY_CURRENCY_CONTRACT: RequiredUpstreamContract = {
  id: "POST /v1/crm/deals/summary#open_value_by_currency",
  method: "POST",
  path: "/v1/crm/deals/summary",
  reason:
    "When the open pipeline spans more than one currency, the summary must report a per-currency breakdown. A single open_value with mixed_currency=true cannot be separated by currency and must not be converted: the Control Center has no rate source carrying a source and a date. Without the breakdown the nominal pipeline stays withheld.",
  min_request: {
    method: "POST",
    path: "/v1/crm/deals/summary",
    headers: AUTH_HEADERS,
    body: { status: "open" },
  },
  min_response: {
    status: 200,
    body: {
      open_count: 0,
      open_value: 0,
      currency: "BRL",
      mixed_currency: false,
      open_value_by_currency: [{ currency: "BRL", value: 0 }],
    },
  },
};

export function contractForUnavailable(path: string, method: string): RequiredUpstreamContract {
  const normalized = path.split("?")[0] ?? path;
  if (normalized === "/v1/confenge/attention") {
    return {
      id: "GET /v1/confenge/attention",
      method: "GET",
      path: "/v1/confenge/attention",
      reason:
        "Feature-flagged Confenge attention list was not readable. Cockpit still derives commercial attention from CRM tasks/deals, unibox, and campaigns; this read is needed to surface Warmbly-native needs-attention accounts.",
      min_request: {
        method: "GET",
        path: "/v1/confenge/attention",
        query: { filter: "needs_attention", limit: "50" },
        headers: AUTH_HEADERS,
      },
      min_response: {
        status: 200,
        body: {
          data: [
            {
              account_id: "uuid",
              company_name: "string",
              commercial_state: "string",
              queue_state: "REPLIED",
              confidence: 0.8,
              updated_at: "RFC3339 UTC",
            },
          ],
        },
      },
    };
  }
  if (normalized === "/v1/confenge/today") {
    return {
      id: "GET /v1/confenge/today",
      method: "GET",
      path: "/v1/confenge/today",
      reason:
        "Feature-flagged Confenge today view was not readable. Next-action attention still comes from CRM tasks when present.",
      min_request: {
        method: "GET",
        path: "/v1/confenge/today",
        headers: AUTH_HEADERS,
      },
      min_response: {
        status: 200,
        body: {
          data: {
            summary: { total: 0 },
            actions: [
              {
                action_id: "uuid",
                company: "string",
                recommended_action: "string",
                next_action_at: "RFC3339 UTC",
                actionable: true,
              },
            ],
          },
        },
      },
    };
  }
  if (normalized === "/v1/confenge/inbound") {
    return {
      id: "GET /v1/confenge/inbound",
      method: "GET",
      path: "/v1/confenge/inbound",
      reason:
        "Feature-flagged inbound-now queue was not readable. Contacts search remains the substitute lead surface.",
      min_request: {
        method: "GET",
        path: "/v1/confenge/inbound",
        headers: AUTH_HEADERS,
      },
      min_response: {
        status: 200,
        body: {
          data: [
            {
              lead_id: "string",
              company: "string",
              status: "NEW",
              why_now: "string",
              recommended_action: "string",
              confidence: "HIGH",
            },
          ],
        },
      },
    };
  }
  if (normalized === "/v1/confenge/ops/health") {
    return {
      id: "GET /v1/confenge/ops/health",
      method: "GET",
      path: "/v1/confenge/ops/health",
      reason:
        "Confenge ops health is feature-flagged. GET /health and GET /v1/confenge/status remain the always-on health/version probes.",
      min_request: {
        method: "GET",
        path: "/v1/confenge/ops/health",
        headers: AUTH_HEADERS,
      },
      min_response: {
        status: 200,
        body: {
          data: {
            computed_at: "RFC3339 UTC",
            health_matrix: { status: "READY" },
            alerts: [],
            slos: [],
          },
        },
      },
    };
  }
  return {
    id: `${method} ${normalized}`,
    method: method === "POST" || method === "HEAD" ? method : "GET",
    path: normalized,
    reason: `Warmbly did not expose a safely readable ${method} ${normalized}. The connector fail-closed this surface instead of inventing or mutating upstream.`,
    min_request: {
      method,
      path: normalized,
      headers: AUTH_HEADERS,
    },
    min_response: {
      status: 200,
      body: { data: [] },
    },
  };
}
