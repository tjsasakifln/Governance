import {
  AsaasMutationForbiddenError,
  AsaasPathNotAllowlistedError,
} from "./errors.js";

export const MUTATION_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

export const ASAAS_GET_ALLOWLIST_PATHS = [
  "GET /v3/customers",
  "GET /v3/customers/{id}",
  "GET /v3/payments",
  "GET /v3/payments/{id}",
  "GET /v3/subscriptions",
  "GET /v3/subscriptions/{id}",
  "GET /v3/pix/transactions",
  "GET /v3/pix/transactions/{id}",
  "GET /v3/finance/balance",
  "GET /v3/financialTransactions",
] as const;

const GET_ALLOWLIST: readonly RegExp[] = [
  /^\/v3\/customers$/,
  /^\/v3\/customers\/[A-Za-z0-9_]+$/,
  /^\/v3\/payments$/,
  /^\/v3\/payments\/[A-Za-z0-9_]+$/,
  /^\/v3\/subscriptions$/,
  /^\/v3\/subscriptions\/[A-Za-z0-9_]+$/,
  /^\/v3\/pix\/transactions$/,
  /^\/v3\/pix\/transactions\/[A-Za-z0-9_-]+$/,
  /^\/v3\/finance\/balance$/,
  /^\/v3\/financialTransactions$/,
];

/**
 * Path fragments that imply create/charge/refund/cancel/update/webhook
 * registration even if someone tries them as GET.
 */
const MUTATION_PATH_MARKERS: readonly string[] = [
  "/refund",
  "/paywithcreditcard",
  "/receiveincash",
  "/undoreceivedincash",
  "/restore",
  "/webhook",
  "/webhooks",
  "/checkouts",
  "/pix/qrcodes",
  "/transfers",
  "/bill",
  "/anticipations",
];

export function normalizeAsaasPath(path: string): string {
  const withoutQuery = path.split("?")[0] ?? path;
  const withLeading = withoutQuery.startsWith("/")
    ? withoutQuery
    : `/${withoutQuery}`;
  const stripped = withLeading.replace(/\/+$/, "");
  return stripped === "" ? "/" : stripped;
}

export function isMutationMethod(method: string): boolean {
  return (MUTATION_METHODS as readonly string[]).includes(method.toUpperCase());
}

export function pathLooksLikeMutation(path: string): boolean {
  const lower = normalizeAsaasPath(path).toLowerCase();
  return MUTATION_PATH_MARKERS.some((marker) => lower.includes(marker));
}

export function isAllowlistedGetPath(path: string): boolean {
  const normalized = normalizeAsaasPath(path);
  if (pathLooksLikeMutation(normalized)) {
    return false;
  }
  return GET_ALLOWLIST.some((re) => re.test(normalized));
}

export function assertGetAllowed(method: string, path: string): void {
  const upper = method.toUpperCase();
  const normalized = normalizeAsaasPath(path);
  if (upper !== "GET" || isMutationMethod(upper)) {
    throw new AsaasMutationForbiddenError(upper, normalized);
  }
  if (pathLooksLikeMutation(normalized)) {
    throw new AsaasMutationForbiddenError(upper, normalized);
  }
  if (!isAllowlistedGetPath(normalized)) {
    throw new AsaasPathNotAllowlistedError(normalized);
  }
}
