/**
 * Local copy of forbidden provider/MCP operations.
 * Documented interface for later convergence with control-center/contracts
 * `forbidden_operations` — this package MUST NOT import that tree.
 */

export const FORBIDDEN_PROVIDER_OPERATIONS = [
  "cc_charge",
  "cc_checkout",
  "cc_refund",
  "cc_cancel_subscription",
  "cc_asaas_write",
  "cc_asaas_create_payment",
  "cc_send_commercial",
  "cobranca",
  "cobrança",
  "checkout",
  "refund",
  "cancelamento",
  "asaas_write",
  "asaas_create_payment",
  "asaas write",
  "commercial_send",
  "commercial send",
] as const;

const NORMALIZED = new Set(
  FORBIDDEN_PROVIDER_OPERATIONS.map((name) => normalizeOpName(name)),
);

export function normalizeOpName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_");
}

export function isForbiddenProviderOperation(name: string): boolean {
  return NORMALIZED.has(normalizeOpName(name));
}

/** MCP tools that are allowed to be observed as read-only in fixtures. */
export const ALLOWED_READONLY_MCP_TOOLS = [
  "cc_get_context",
  "cc_list_directives",
  "cc_list_attention",
  "cc_list_priorities",
  "cc_get_snapshot",
  "cc_get_client_status",
  "cc_list_scopes",
  "cc_get_service_health",
] as const;
