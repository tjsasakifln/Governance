import type { DestinationId } from "../destinations";
import { getDestination } from "../destinations";
import type {
  ActorRef,
  AttentionItem,
  Directive,
  PriorityRecommendation,
  Provenance,
} from "../types";
import {
  ADAPTER_ACTIONS,
  type AdapterAction,
  type AdapterReadResult,
  type ControlCenterReadAdapter,
  type DestinationPage,
} from "./contract";
import { createMockAdapter } from "./mock";

function scopeFor(id: DestinationId): string {
  return getDestination(id).scope;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function provenanceOf(row: Record<string, unknown>, fallback: Provenance): Provenance {
  const source = asRecord(row.source);
  const freshness = row.freshness_status;
  return {
    source: source
      ? {
          system: String(source.system ?? "control-center"),
          kind: String(source.kind ?? "context"),
          locator: String(source.locator ?? "http"),
        }
      : fallback.source,
    observed_at: String(row.observed_at ?? fallback.observed_at),
    freshness_status:
      freshness === "FRESH" || freshness === "STALE" || freshness === "UNKNOWN" || freshness === "ERROR"
        ? freshness
        : fallback.freshness_status,
    confidence: typeof row.confidence === "number" ? row.confidence : fallback.confidence,
  };
}

function attentionFrom(row: Record<string, unknown>, fallback: Provenance): AttentionItem {
  const prov = provenanceOf(row, fallback);
  return {
    schema_version: "control-center.attention-item.v1",
    id: String(row.id ?? "cc:attention-item:unknown"),
    scope: String(row.scope ?? "company"),
    severity: (row.severity as AttentionItem["severity"]) ?? "medium",
    status: (row.status as AttentionItem["status"]) ?? "open",
    title: String(row.title ?? "Sem título"),
    summary: String(row.summary ?? row.body ?? ""),
    provenance: prov,
    detected_at: String(row.detected_at ?? prov.observed_at),
    homepage_eligible: row.homepage_eligible !== false,
  };
}

function priorityFrom(row: Record<string, unknown>, index: number, fallback: Provenance): PriorityRecommendation {
  const prov = provenanceOf(row, fallback);
  return {
    schema_version: "control-center.priority-recommendation.v1",
    id: String(row.id ?? `cc:priority-recommendation:${index}`),
    scope: String(row.scope ?? "company"),
    rank: typeof row.rank === "number" ? row.rank : index + 1,
    title: String(row.title ?? "Prioridade"),
    rationale: String(row.rationale ?? row.body ?? ""),
    provenance: prov,
    generated_at: String(row.generated_at ?? prov.observed_at),
    horizon: (row.horizon as PriorityRecommendation["horizon"]) ?? "today",
  };
}

function directiveFrom(row: Record<string, unknown>): Directive {
  const created = asRecord(row.created_by);
  return {
    schema_version: "control-center.directive.v1",
    id: String(row.id ?? "cc:directive:unknown"),
    kind: (row.kind as Directive["kind"]) ?? "fact",
    scope: String(row.scope ?? "company"),
    status: (row.status as Directive["status"]) ?? "active",
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    effective_from: String(row.effective_from ?? new Date().toISOString()),
    expires_at: row.expires_at === null || row.expires_at === undefined ? null : String(row.expires_at),
    supersedes: Array.isArray(row.supersedes) ? (row.supersedes as string[]) : null,
    created_by: {
      kind: (created?.kind as ActorRef["kind"]) ?? "human",
      id: String(created?.id ?? "unknown"),
    },
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
    audit: [],
  };
}

export class HttpControlCenterAdapter implements ControlCenterReadAdapter {
  readonly mode = "http" as const;
  readonly actions: readonly AdapterAction[] = ADAPTER_ACTIONS;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly operator: ActorRef;

  constructor(options: { baseUrl: string; fetchImpl?: typeof fetch; operator?: ActorRef }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.operator = options.operator ?? { kind: "human", id: "human:operator", display_name: "Operador" };
  }

  readOperator(): ActorRef {
    return { ...this.operator };
  }

  async readDestination(id: DestinationId): Promise<AdapterReadResult> {
    try {
      const page = await this.loadPage(id);
      return { ok: true, loading: false, page };
    } catch (err) {
      return {
        ok: false,
        loading: false,
        error: {
          code: "CONTEXT_UNAVAILABLE",
          message: err instanceof Error ? err.message : "context http failed",
        },
      };
    }
  }

  async readAttention(): Promise<AttentionItem[]> {
    const result = await this.readDestination("hoje");
    if (!result.ok || result.loading) return [];
    return result.page.attention;
  }

  async readPriorities(): Promise<PriorityRecommendation[]> {
    const result = await this.readDestination("hoje");
    if (!result.ok || result.loading) return [];
    return result.page.priorities;
  }

  private async loadPage(id: DestinationId): Promise<DestinationPage> {
    const scope = scopeFor(id);
    const ctx = asRecord(await this.getJson(`/v1/context?scope=${encodeURIComponent(scope)}`));
    if (!ctx) {
      throw new Error("context payload is not an object");
    }
    const fallback: Provenance = provenanceOf(ctx, {
      source: { system: "control-center", kind: "context", locator: this.baseUrl },
      observed_at: new Date().toISOString(),
      freshness_status: "UNKNOWN",
      confidence: 0,
    });
    const directives = Array.isArray(ctx.active_directives)
      ? ctx.active_directives.map((row) => directiveFrom(asRecord(row) ?? {}))
      : [];
    const riskRows =
      Array.isArray(ctx.risks) && ctx.risks.length > 0
        ? ctx.risks
        : Array.isArray(ctx.active_directives)
          ? ctx.active_directives.filter((row) => asRecord(row)?.kind === "risk")
          : directives.filter((row) => row.kind === "risk");
    const attention = riskRows.map((row) => attentionFrom(asRecord(row) ?? {}, fallback));
    const priorities = (Array.isArray(ctx.priorities) ? ctx.priorities : [])
      .slice(0, 3)
      .map((row, index) => priorityFrom(asRecord(row) ?? {}, index, fallback));
    return {
      id,
      label: getDestination(id).label,
      scope,
      generated_at: fallback.observed_at,
      operator: this.readOperator(),
      headline: getDestination(id).description,
      attention,
      priorities,
      directives,
    };
  }

  private async getJson(path: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: {
        accept: "application/json",
        "x-actor-id": this.operator.id,
        "x-actor-kind": this.operator.kind,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`context ${response.status}`);
    }
    return JSON.parse(text) as unknown;
  }
}

export function createHttpAdapter(
  baseUrl: string,
  fetchImpl?: typeof fetch,
  operator?: ActorRef,
): HttpControlCenterAdapter {
  return new HttpControlCenterAdapter({
    baseUrl,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(operator ? { operator } : {}),
  });
}

export function productionActorFromDocument(
  doc: { querySelector(selector: string): { getAttribute(name: string): string | null } | null } | undefined =
    typeof document !== "undefined" ? document : undefined,
): ActorRef | undefined {
  const id = doc?.querySelector('meta[name="cc-actor-id"]')?.getAttribute("content")?.trim();
  const kind = doc?.querySelector('meta[name="cc-actor-kind"]')?.getAttribute("content")?.trim();
  if (!id || (kind !== "human" && kind !== "agent" && kind !== "system")) {
    return undefined;
  }
  return { kind, id };
}

export function productionContextUrl(): string {
  const meta =
    typeof document !== "undefined"
      ? document.querySelector('meta[name="cc-context-url"]')?.getAttribute("content")
      : null;
  if (meta && meta.trim()) {
    return meta.trim();
  }
  if (typeof window !== "undefined") {
    const injected = (window as unknown as { __CC_CONTEXT_URL__?: string }).__CC_CONTEXT_URL__;
    if (injected && injected.trim()) {
      return injected.trim();
    }
  }
  return "";
}

export function createProductionAdapter(): ControlCenterReadAdapter {
  const mock =
    typeof document !== "undefined" &&
    document.querySelector('meta[name="cc-use-mock"]')?.getAttribute("content") === "1";
  if (mock) {
    return createMockAdapter();
  }
  const base = productionContextUrl() || "";
  return createHttpAdapter(base, undefined, productionActorFromDocument());
}
