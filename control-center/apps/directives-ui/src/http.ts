import { assertCanMutate, type IdentityEnv, resolveIdentity } from "./actor.ts";
import { isForbiddenMutation } from "./contract.ts";
import { buildDirective, type CreateDraft, defaultCreateDraft, draftToInput } from "./create.ts";
import { systemClock, toUtcDateTime } from "./datetime.ts";

type Clock = { now(): Date };
import { DirectiveUiError } from "./errors.ts";
import { EMPTY_FILTER, filterDirectives } from "./filter.ts";
import { logEvent } from "./log.ts";
import { observeDirective } from "./observe.ts";
import { previewAgentContext } from "./preview.ts";
import { supersedeDirective } from "./supersede.ts";
import type {
  AgentScopePreview,
  CreateDirectiveInput,
  Directive,
  DirectiveFilter,
  ObservedDirective,
  ResourceId,
  SessionIdentity,
} from "./types.ts";
import type { DirectiveMemoryPort } from "./service.ts";

export class HttpDirectiveService implements DirectiveMemoryPort {
  readonly mode = "http" as const;
  private cache: Directive[] = [];
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly session: SessionIdentity;
  private readonly clock: Clock;

  constructor(options: {
    baseUrl: string;
    identity: SessionIdentity;
    fetchImpl?: typeof fetch;
    clock?: Clock;
    initial?: Directive[];
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.session = options.identity;
    this.clock = options.clock ?? systemClock();
    this.cache = options.initial ?? [];
  }

  identity(): SessionIdentity {
    return this.session;
  }

  list(filter: DirectiveFilter = EMPTY_FILTER): Directive[] {
    return filterDirectives(this.cache, filter);
  }

  get(id: ResourceId): Directive | undefined {
    return this.cache.find((row) => row.id === id);
  }

  observe(id: ResourceId): ObservedDirective | undefined {
    const record = this.get(id);
    if (!record) return undefined;
    return observeDirective(record, toUtcDateTime(this.clock.now()));
  }

  create(input: CreateDirectiveInput): Directive {
    assertCanMutate(this.session);
    const record = buildDirective(input, this.session.actor, this.clock);
    this.cache = [...this.cache, record];
    logEvent("directive.create", { id: record.id, kind: record.kind, transport: "http" });
    void this.post("/v1/directives", {
      kind: record.kind,
      title: record.title,
      body: record.body,
      scope: record.scope,
      status: record.status,
      source: { system: "control-center", kind: "directives-ui", locator: record.id },
      confidence: 1,
    });
    return record;
  }

  createFromDraft(draft: CreateDraft): Directive {
    return this.create(draftToInput(draft));
  }

  supersede(predecessorId: ResourceId, input: CreateDirectiveInput): {
    predecessor: Directive;
    successor: Directive;
  } {
    assertCanMutate(this.session);
    const current = this.get(predecessorId);
    if (!current) {
      throw new DirectiveUiError("not_found", "predecessor does not exist", { id: predecessorId });
    }
    const result = supersedeDirective(current, input, this.session.actor, this.clock);
    this.cache = this.cache.map((row) => (row.id === result.predecessor.id ? result.predecessor : row));
    this.cache = [...this.cache, result.successor];
    void this.post(`/v1/directives/${encodeURIComponent(predecessorId)}/supersede`, {
      kind: result.successor.kind,
      title: result.successor.title,
      body: result.successor.body,
      scope: result.successor.scope,
      source: { system: "control-center", kind: "directives-ui", locator: result.successor.id },
      confidence: 1,
    });
    return result;
  }

  preview(scope: string): AgentScopePreview {
    return previewAgentContext(this.cache, scope, this.clock);
  }

  newDraft(): CreateDraft {
    return defaultCreateDraft(this.clock.now());
  }

  refusesForbiddenMutation(action: string): boolean {
    return isForbiddenMutation(action);
  }

  async refresh(scope = "company"): Promise<void> {
    const payload = (await this.getJson(`/v1/active-directives?scope=${encodeURIComponent(scope)}`)) as {
      items?: unknown[];
    };
    const items = Array.isArray(payload.items) ? payload.items : [];
    this.cache = items.map((row) => asDirective(row));
  }

  private async getJson(path: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: {
        accept: "application/json",
        "x-actor-id": this.session.actor.id,
        "x-actor-kind": this.session.actor.kind,
      },
    });
    return response.json();
  }

  private async post(path: string, body: unknown): Promise<void> {
    await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-actor-id": this.session.actor.id,
        "x-actor-kind": this.session.actor.kind,
      },
      body: JSON.stringify(body),
    });
  }
}

function asDirective(raw: unknown): Directive {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const created = row.created_by && typeof row.created_by === "object" ? (row.created_by as Record<string, unknown>) : {};
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
      kind: (created.kind as Directive["created_by"]["kind"]) ?? "human",
      id: String(created.id ?? "unknown"),
    },
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
    audit: [],
  };
}

export async function createHttpDirectiveService(
  baseUrl: string,
  env: IdentityEnv,
  fetchImpl?: typeof fetch,
): Promise<HttpDirectiveService> {
  const options: { baseUrl: string; identity: SessionIdentity; fetchImpl?: typeof fetch } = {
    baseUrl,
    identity: resolveIdentity(env),
  };
  if (fetchImpl) {
    options.fetchImpl = fetchImpl;
  }
  const service = new HttpDirectiveService(options);
  await service.refresh("company");
  return service;
}
