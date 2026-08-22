import type { DestinationId } from "../destinations";
import { getDestination } from "../destinations";

export const AUTHORIZED_WRITE_PATH = "/v1/directives";

export const WRITE_SHORTCUT_KINDS = ["decision", "nota", "risco", "hipotese"] as const;
export type WriteShortcutKind = (typeof WRITE_SHORTCUT_KINDS)[number];

export const WRITE_SHORTCUT_DIRECTIVE_KIND = {
  decision: "decision",
  nota: "fact",
  risco: "risk",
  hipotese: "hypothesis",
} as const;

export const WRITE_SHORTCUT_LABELS: Record<WriteShortcutKind, string> = {
  decision: "Registrar decisão",
  nota: "Registrar nota",
  risco: "Registrar risco",
  hipotese: "Registrar hipótese",
};

const DOMAIN_BY_DESTINATION: Record<Exclude<DestinationId, "hoje" | "memoria" | "agentes">, string> = {
  comercial: "commercial",
  clientes: "clients",
  financeiro: "finance",
  engenharia: "engineering",
  infra: "infrastructure",
  crescimento: "commercial",
};

function q(path: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params);
  return `${path}?${search.toString()}`;
}

export function readPathsFor(id: DestinationId): readonly string[] {
  const scope = getDestination(id).scope;
  switch (id) {
    case "hoje":
      return [
        q("/v1/today", { scope: "company" }),
        q("/v1/attention", { scope: "company", horizon: "now" }),
        q("/v1/attention", { scope: "company", horizon: "today" }),
        q("/v1/operational-snapshots", { scope: "company" }),
        q("/v1/agent-activities", { scope: "company" }),
      ];
    case "memoria":
      return [q("/v1/context", { scope })];
    case "agentes":
      return [q("/v1/agent-activities", { scope })];
    case "crescimento":
      return [
        q("/v1/domains/commercial", { scope: "commercial" }),
        q("/v1/domains/pncp", { scope: "inbound" }),
      ];
    default:
      return [q(`/v1/domains/${DOMAIN_BY_DESTINATION[id]}`, { scope })];
  }
}

export function isContextPath(url: string): boolean {
  try {
    const parsed = new URL(url, "https://ops.confenge.com.br/");
    return parsed.pathname === "/v1/context";
  } catch {
    return url.includes("/v1/context");
  }
}

export function destinationUsesContext(id: DestinationId): boolean {
  return id === "memoria";
}

export function isAuthorizedWritePath(path: string): boolean {
  const pathname = path.split("?")[0] ?? path;
  return pathname === AUTHORIZED_WRITE_PATH;
}

/**
 * Warmbly dispatch control routes, mounted by the context service ahead of its
 * own `x-actor-id` actor resolution. Kept here so a test can assert the set is
 * exactly these four and nothing wider.
 */
/** Read-back of the operator channel's own audit record. GET, same Authelia gate. */
export const WARMBLY_OPERATOR_LEDGER_PATH = "/v1/warmbly/operator/ledger/recent";

export const WARMBLY_DISPATCH_PATHS = {
  pause: "/v1/warmbly/operator/dispatch/pause",
  resume_confirm: "/v1/warmbly/operator/dispatch/resume/confirm",
  resume: "/v1/warmbly/operator/dispatch/resume",
  acknowledge: "/v1/warmbly/operator/inbound/acknowledge",
} as const;
