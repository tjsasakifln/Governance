/**
 * Fail-closed method/path allowlist.
 *
 * GET/HEAD of known commercial read surfaces, plus Warmbly's existing POST
 * /search and /summary on contacts/deals/tasks (read queries; they must not
 * change upstream state). Every other POST, and all PATCH/PUT/DELETE, is
 * denied even if a caller asks.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GET_EXACT = new Set<string>([
  "/health",
  "/v1/crm/pipelines",
  "/v1/crm/deals",
  "/v1/crm/tasks",
  "/v1/crm/task-types",
  "/v1/campaigns",
  "/v1/campaigns-overview",
  "/v1/unibox/overview",
  "/v1/unibox/count",
  "/v1/confenge/status",
  "/v1/confenge/ops/health",
  "/v1/confenge/attention",
  "/v1/confenge/today",
  "/v1/confenge/inbound",
  "/v1/confenge/summary",
  "/v1/confenge/accounts",
  "/v1/confenge/working-overview",
  "/v1/confenge/dispatch/status",
  "/v1/confenge/intel/scoreboard",
  "/v1/confenge/intel/executive",
  "/v1/confenge/intel/report",
  "/v1/confenge/intel/exceptions",
  "/v1/confenge/intel/organic-scoreboard",
]);

export const POST_READ_EXACT = new Set<string>([
  "/v1/contacts/search",
  "/v1/crm/deals/search",
  "/v1/crm/deals/summary",
  "/v1/crm/tasks/search",
  "/v1/crm/tasks/summary",
]);

const MUTATING_POST_PREFIXES = [
  "/v1/campaigns/",
  "/v1/contacts",
  "/v1/confenge/",
  "/v1/unibox/",
  "/v1/crm/deals",
  "/v1/crm/tasks",
  "/v1/crm/pipelines",
];

export function pathnameOf(urlOrPath: string): string {
  try {
    if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
      return new URL(urlOrPath).pathname;
    }
  } catch {
    // fall through
  }
  const cut = urlOrPath.split("?")[0] ?? urlOrPath;
  return cut.startsWith("/") ? cut : `/${cut}`;
}

function isUuidSegment(seg: string): boolean {
  return UUID.test(seg);
}

function isAllowedGetPath(pathname: string): boolean {
  if (GET_EXACT.has(pathname)) {
    return true;
  }
  const parts = pathname.split("/").filter((p) => p.length > 0);
  if (parts[0] !== "v1") {
    return false;
  }
  if (parts[1] === "contacts" && parts.length === 3 && isUuidSegment(parts[2] ?? "")) {
    return true;
  }
  if (
    parts[1] === "crm" &&
    (parts[2] === "deals" || parts[2] === "tasks" || parts[2] === "pipelines") &&
    parts.length === 4 &&
    isUuidSegment(parts[3] ?? "")
  ) {
    return true;
  }
  if (parts[1] === "campaigns" && parts.length === 3 && isUuidSegment(parts[2] ?? "")) {
    return true;
  }
  if (
    parts[1] === "confenge" &&
    parts[2] === "attention" &&
    parts.length === 4 &&
    isUuidSegment(parts[3] ?? "")
  ) {
    return true;
  }
  if (
    parts[1] === "confenge" &&
    parts[2] === "accounts" &&
    parts.length === 4 &&
    isUuidSegment(parts[3] ?? "")
  ) {
    return true;
  }
  return false;
}

export type DeniedRequest = {
  allowed: false;
  method: string;
  path: string;
  reason: string;
};

export type AllowedRequest = {
  allowed: true;
  method: "GET" | "HEAD" | "POST";
  path: string;
};

export function classifyRequest(
  method: string,
  urlOrPath: string,
): AllowedRequest | DeniedRequest {
  const path = pathnameOf(urlOrPath);
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") {
    if (isAllowedGetPath(path)) {
      return { allowed: true, method: m, path };
    }
    return {
      allowed: false,
      method: m,
      path,
      reason: `GET/HEAD path is not on the Warmbly commercial read allowlist: ${path}`,
    };
  }
  if (m === "POST") {
    if (POST_READ_EXACT.has(path)) {
      return { allowed: true, method: "POST", path };
    }
    const mutating = MUTATING_POST_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(prefix),
    );
    return {
      allowed: false,
      method: m,
      path,
      reason: mutating
        ? `Mutating POST is forbidden on the Warmbly connector: ${path}`
        : `POST path is not a documented read-search/summary: ${path}`,
    };
  }
  return {
    allowed: false,
    method: m,
    path,
    reason: `${m} is forbidden (connector is read-only; only GET/HEAD and documented search/summary POST)`,
  };
}

export function isAllowedRead(method: string, urlOrPath: string): boolean {
  return classifyRequest(method, urlOrPath).allowed;
}
