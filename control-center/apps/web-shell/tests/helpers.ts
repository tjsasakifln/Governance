import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHttpAdapter } from "../src/adapters/index";
import { DESTINATION_IDS, type DestinationId } from "../src/destinations";
import { readPathsFor } from "../src/adapters/paths";

const here = dirname(fileURLToPath(import.meta.url));
export const CONTRACT_FIXTURES = join(here, "../../../contracts/fixtures/valid");

export function readContractFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(CONTRACT_FIXTURES, `${name}.json`), "utf8")) as unknown;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function recordingFetch(
  router: (url: string) => unknown,
  calls: string[] = [],
): { fetchImpl: typeof fetch; calls: string[] } {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if ((init?.method ?? "GET") !== "GET") {
      const body = router(path);
      return jsonResponse(body ?? { ok: true }, 201);
    }
    const payload = router(path);
    if (payload instanceof Response) return payload;
    if (payload === undefined) {
      return jsonResponse({ error: "not_found" }, 404);
    }
    return jsonResponse(payload);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export function operationalRouter(): (url: string) => unknown {
  const commercial = readContractFixture("commercial-snapshot");
  const finance = readContractFixture("finance-snapshot");
  const engineering = readContractFixture("engineering-snapshot");
  const client = readContractFixture("client-status");
  const health = readContractFixture("service-health");
  const attention = readContractFixture("attention-item");
  const priority = readContractFixture("priority-recommendation");
  const activity = readContractFixture("agent-activity");
  const snapshot = readContractFixture("operational-snapshot");
  const directive = readContractFixture("directive");
  const today = {
    schema_version: "control-center.hoje-payload.v1",
    generated_at: "2026-08-20T18:00:00Z",
    headline: "Exceções operacionais reais.",
    recommended_actions: [priority],
    incidents: [attention],
    clients: [client],
    commercial,
    finance,
    engineering,
    infra: [health],
    agent_activity: [activity],
  };
  const context = {
    scope: "company",
    active_directives: [directive],
    decisions: [directive],
    facts: [],
    constraints: [directive],
    priorities: [],
    risks: [],
    directives: [],
    hypotheses: [],
    source: { system: "control-center", kind: "context", locator: "company" },
    observed_at: "2026-08-20T12:00:00Z",
    freshness_status: "FRESH",
    confidence: 1,
  };
  return (url: string) => {
    const path = url.split("?")[0] ?? url;
    if (path.endsWith("/v1/today")) return today;
    if (path.endsWith("/v1/attention")) return { items: [attention] };
    if (path.endsWith("/v1/operational-snapshots")) return snapshot;
    if (path.endsWith("/v1/agent-activities")) return { items: [activity] };
    if (path.endsWith("/v1/domains/commercial")) return commercial;
    if (path.endsWith("/v1/domains/clients")) return { items: [client] };
    if (path.endsWith("/v1/domains/finance")) return finance;
    if (path.endsWith("/v1/domains/engineering")) return engineering;
    if (path.endsWith("/v1/domains/infrastructure")) return { items: [health] };
    if (path.endsWith("/v1/domains/pncp")) return health;
    if (path.endsWith("/v1/context")) return context;
    if (path.endsWith("/v1/directives")) return { ok: true };
    return undefined;
  };
}

export function httpAdapterFor(router = operationalRouter(), calls: string[] = []) {
  const { fetchImpl } = recordingFetch(router, calls);
  return {
    adapter: createHttpAdapter("http://127.0.0.1:8787", fetchImpl, {
      kind: "human",
      id: "founder-local",
    }),
    calls,
  };
}

export function pathOf(url: string): string {
  return url.replace(/^GET |^POST /, "").replace(/^https?:\/\/[^/]+/, "");
}

export { DESTINATION_IDS, readPathsFor };
export type { DestinationId };
