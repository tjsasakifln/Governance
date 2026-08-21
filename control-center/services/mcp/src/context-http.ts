import type {
  BlockerInput,
  ClientContext,
  CompanyState,
  ContextApiPort,
  DecisionRecord,
  DirectiveRecord,
  PriorityRecord,
  ScopedContext,
  SessionResultInput,
  WriteReceipt,
} from "./types.js";

export class ContextHttpError extends Error {
  override readonly name = "ContextHttpError";
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function utcNow(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function freshnessOf(value: unknown): WriteReceipt["freshness_status"] {
  if (value === "FRESH" || value === "STALE" || value === "UNKNOWN" || value === "ERROR") {
    return value;
  }
  return "UNKNOWN";
}

function sourceOf(value: unknown): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  const rec = asRecord(value);
  if (!rec) {
    return "control-center.context";
  }
  const system = typeof rec.system === "string" ? rec.system : "control-center";
  const kind = typeof rec.kind === "string" ? rec.kind : "context";
  return `${system}:${kind}`;
}

export function createHttpContextApi(options: {
  baseUrl: string;
  actorId?: string;
  actorKind?: string;
  fetchImpl?: typeof fetch;
}): ContextApiPort {
  const base = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const actorId = options.actorId ?? "mcp-agent";
  const actorKind = options.actorKind ?? "agent";

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("x-actor-id", actorId);
    headers.set("x-actor-kind", actorKind);
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const response = await fetchImpl(`${base}${path}`, { ...init, headers });
    const text = await response.text();
    let parsed: unknown = {};
    if (text.trim()) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = { raw: text };
      }
    }
    if (!response.ok) {
      const rec = asRecord(parsed);
      const message =
        rec && typeof rec.message === "string" ? rec.message : `context http ${response.status}`;
      throw new ContextHttpError(response.status, message);
    }
    return parsed;
  }

  function mapDirective(row: Record<string, unknown>): DirectiveRecord {
    const createdBy = asRecord(row.created_by);
    return {
      id: String(row.id ?? ""),
      kind: (row.kind as DirectiveRecord["kind"]) ?? "directive",
      body: String(row.body ?? ""),
      scope: String(row.scope ?? ""),
      status: (row.status as DirectiveRecord["status"]) ?? "active",
      effective_from: String(row.effective_from ?? utcNow()),
      expires_at: row.expires_at === null || row.expires_at === undefined ? null : String(row.expires_at),
      supersedes: Array.isArray(row.supersedes)
        ? String(row.supersedes[0] ?? "")
        : row.supersedes
          ? String(row.supersedes)
          : null,
      created_by: createdBy && typeof createdBy.id === "string" ? createdBy.id : String(row.created_by ?? "unknown"),
      source: sourceOf(row.source),
      observed_at: String(row.observed_at ?? utcNow()),
      freshness_status: freshnessOf(row.freshness_status),
      confidence: typeof row.confidence === "number" ? row.confidence : undefined,
      audit: {
        created_at: String(row.effective_from ?? utcNow()),
        updated_at: String(row.observed_at ?? utcNow()),
        events: [],
      },
    };
  }

  function mapContextRecord(row: Record<string, unknown>) {
    return {
      id: String(row.id ?? ""),
      kind: (row.kind as ScopedContext["records"][number]["kind"]) ?? "fact",
      title: String(row.title ?? ""),
      body: String(row.body ?? ""),
      scope: String(row.scope ?? ""),
      source: sourceOf(row.source),
      observed_at: String(row.observed_at ?? utcNow()),
      freshness_status: freshnessOf(row.freshness_status),
      confidence: typeof row.confidence === "number" ? row.confidence : undefined,
    };
  }

  async function report(kind: WriteReceipt["kind"], input: SessionResultInput | BlockerInput): Promise<WriteReceipt> {
    const body =
      kind === "blocker"
        ? { ...input, kind: "blocker" }
        : { ...input, kind: "session_result" };
    const parsed = asRecord(await request("/v1/agent-activities", {
      method: "POST",
      body: JSON.stringify(body),
    }));
    const observed_at = String(parsed?.observed_at ?? asRecord(parsed?.provenance)?.observed_at ?? utcNow());
    const freshness = freshnessOf(
      parsed?.freshness_status ?? asRecord(parsed?.provenance)?.freshness_status,
    );
    return {
      accepted: true,
      id: String(parsed?.id ?? ""),
      kind,
      recorded_at: observed_at,
      source: sourceOf(parsed?.source ?? asRecord(parsed?.provenance)?.source),
      observed_at,
      freshness_status: freshness,
      confidence: typeof parsed?.confidence === "number" ? parsed.confidence : 1,
    };
  }

  return {
    async getCompanyState(): Promise<CompanyState> {
      const ctx = asRecord(await request("/v1/context?scope=company"));
      const priorities = Array.isArray(ctx?.priorities)
        ? ctx.priorities.map((row) => {
            const rec = asRecord(row) ?? {};
            return {
              id: String(rec.id ?? ""),
              rank: typeof rec.rank === "number" ? rec.rank : 1,
              title: String(rec.title ?? ""),
              body: String(rec.body ?? ""),
              scope: String(rec.scope ?? "company"),
              kind: "priority" as const,
              source: sourceOf(rec.source),
              observed_at: String(rec.observed_at ?? utcNow()),
              freshness_status: freshnessOf(rec.freshness_status),
              confidence: typeof rec.confidence === "number" ? rec.confidence : undefined,
            };
          })
        : [];
      return {
        company_id: "company",
        display_timezone: "UTC",
        top_three: priorities.slice(0, 3),
        exceptions: [],
        source: sourceOf(ctx?.source),
        observed_at: String(ctx?.observed_at ?? utcNow()),
        freshness_status: freshnessOf(ctx?.freshness_status),
        confidence: typeof ctx?.confidence === "number" ? ctx.confidence : undefined,
      };
    },
    async getContext(scope: string): Promise<ScopedContext> {
      const ctx = asRecord(await request(`/v1/context?scope=${encodeURIComponent(scope)}`));
      const records = Array.isArray(ctx?.active_directives)
        ? ctx.active_directives.map((row) => mapContextRecord(asRecord(row) ?? {}))
        : [];
      return {
        scope,
        records,
        source: sourceOf(ctx?.source),
        observed_at: String(ctx?.observed_at ?? utcNow()),
        freshness_status: freshnessOf(ctx?.freshness_status),
        confidence: typeof ctx?.confidence === "number" ? ctx.confidence : undefined,
      };
    },
    async getActiveDirectives(scope: string): Promise<DirectiveRecord[]> {
      const body = asRecord(await request(`/v1/active-directives?scope=${encodeURIComponent(scope)}`));
      const items = Array.isArray(body?.items) ? body.items : [];
      return items.map((row) => mapDirective(asRecord(row) ?? {}));
    },
    async getPriorities(): Promise<PriorityRecord[]> {
      const body = asRecord(await request("/v1/priorities?scope=company"));
      const items = Array.isArray(body?.items) ? body.items : [];
      return items.map((row, index) => {
        const rec = asRecord(row) ?? {};
        return {
          id: String(rec.id ?? ""),
          rank: typeof rec.rank === "number" ? rec.rank : index + 1,
          title: String(rec.title ?? ""),
          body: String(rec.body ?? ""),
          scope: String(rec.scope ?? "company"),
          kind: "priority" as const,
          source: sourceOf(rec.source),
          observed_at: String(rec.observed_at ?? utcNow()),
          freshness_status: freshnessOf(rec.freshness_status),
          confidence: typeof rec.confidence === "number" ? rec.confidence : undefined,
        };
      });
    },
    async getClientContext(client: string): Promise<ClientContext> {
      const scope = client.startsWith("client:") ? client : `client:${client}`;
      const ctx = await this.getContext(scope);
      return {
        client,
        display_name: client,
        records: ctx.records,
        open_amount: { amount_cents: 0, currency: "BRL" },
        source: ctx.source,
        observed_at: ctx.observed_at,
        freshness_status: ctx.freshness_status,
        confidence: ctx.confidence,
      };
    },
    async getDecisions(since?: string): Promise<DecisionRecord[]> {
      const body = asRecord(await request("/v1/decisions?scope=company"));
      const items = Array.isArray(body?.items) ? body.items : [];
      return items
        .map((row) => {
          const rec = asRecord(row) ?? {};
          const mapped = mapDirective(rec);
          return {
            ...mapped,
            kind: "decision" as const,
            title: String(rec.title ?? ""),
            decided_at: String(rec.effective_from ?? mapped.observed_at),
          };
        })
        .filter((row) => !since || Date.parse(row.decided_at) >= Date.parse(since));
    },
    reportSessionResult(input: SessionResultInput): Promise<WriteReceipt> {
      return report("session_result", input);
    },
    reportBlocker(input: BlockerInput): Promise<WriteReceipt> {
      return report("blocker", input);
    },
  };
}

export function createContextApiFromEnv(
  env: NodeJS.ProcessEnv,
  createStub: () => ContextApiPort,
): ContextApiPort {
  const url = (env.CONTROL_CENTER_CONTEXT_URL ?? "").trim();
  const production =
    (env.NODE_ENV ?? "").trim().toLowerCase() === "production" ||
    (env.CONTROL_CENTER_ENV ?? "").trim().toLowerCase() === "production";
  if (url) {
    return createHttpContextApi({
      baseUrl: url,
      actorId: env.CONTROL_CENTER_MCP_ACTOR_ID?.trim() || "mcp-agent",
      actorKind: env.CONTROL_CENTER_MCP_ACTOR_KIND?.trim() || "agent",
    });
  }
  if (production) {
    throw new Error("CONTROL_CENTER_CONTEXT_URL is required in production; refusing stub ContextApiPort");
  }
  return createStub();
}
