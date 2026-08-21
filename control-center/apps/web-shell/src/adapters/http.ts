import type { DestinationId } from "../destinations";
import { getDestination } from "../destinations";
import type { ActorRef, AttentionItem, PriorityRecommendation, Provenance } from "../types";
import {
  ADAPTER_ACTIONS,
  type AdapterAction,
  type AdapterReadResult,
  type AdapterWriteResult,
  type ControlCenterReadAdapter,
  type DestinationPage,
} from "./contract";
import {
  activityFrom,
  asRecord,
  clientFrom,
  commercialFrom,
  composePageFromHojeInput,
  engineeringFrom,
  fallbackProvenance,
  financeFrom,
  healthFrom,
  itemsOf,
  mapContextDirectives,
  mapHojePayloads,
} from "./map";
import {
  AUTHORIZED_WRITE_PATH,
  WRITE_SHORTCUT_DIRECTIVE_KIND,
  WRITE_SHORTCUT_KINDS,
  destinationUsesContext,
  isAuthorizedWritePath,
  readPathsFor,
  type WriteShortcutKind,
} from "./paths";

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
          message:
            err instanceof Error
              ? err.message
              : "Backend operacional indisponível. Nenhuma origem mock foi usada.",
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

  async operatorAction(input: {
    action_type: string;
    target_canonical_id: string;
    target_source_id: string;
    note: string;
    idempotency_key?: string;
  }): Promise<AdapterWriteResult> {
    const forbidden = [
      "SEND_CAMPAIGN",
      "SEND_EMAIL",
      "SEND_WHATSAPP",
      "AUTO_SEND_ENABLE",
      "CHARGE",
      "REFUND",
      "PAYMENT",
    ];
    if (forbidden.includes(input.action_type)) {
      return { ok: false, path: "/v1/operator-actions", kind: "nota", message: "ação comercial proibida" };
    }
    try {
      const idempotency = input.idempotency_key ?? `${input.action_type}:${input.target_canonical_id}:${input.note}`;
      const response = await this.fetchImpl(`${this.baseUrl}/v1/operator-actions`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-actor-id": this.operator.id,
          "x-actor-kind": this.operator.kind,
        },
        body: JSON.stringify({
          action_type: input.action_type,
          target_canonical_id: input.target_canonical_id,
          target_source_id: input.target_source_id,
          note: input.note,
          idempotency_key: idempotency,
          correlation_id: idempotency,
          scope: "commercial",
        }),
      });
      if (!response.ok) {
        return { ok: false, path: "/v1/operator-actions", kind: "nota", message: `recusado (${response.status})` };
      }
      return { ok: true, path: "/v1/operator-actions", kind: "nota", message: "ação registrada no Control Center" };
    } catch (err) {
      return {
        ok: false,
        path: "/v1/operator-actions",
        kind: "nota",
        message: err instanceof Error ? err.message : "gravação indisponível",
      };
    }
  }

  async writeShortcut(kind: WriteShortcutKind, draft: { title: string; body: string }): Promise<AdapterWriteResult> {
    if (!(WRITE_SHORTCUT_KINDS as readonly string[]).includes(kind)) {
      return { ok: false, path: AUTHORIZED_WRITE_PATH, kind, message: "atalho não autorizado" };
    }
    const title = draft.title.trim();
    const body = draft.body.trim();
    if (!title || !body) {
      return { ok: false, path: AUTHORIZED_WRITE_PATH, kind, message: "título e corpo são obrigatórios" };
    }
    const observed_at = new Date().toISOString();
    const payload = {
      kind: WRITE_SHORTCUT_DIRECTIVE_KIND[kind],
      title,
      body,
      scope: "company",
      source: {
        system: "control-center",
        kind: "founder-shortcut",
        locator: "hoje",
      },
      observed_at,
      freshness_status: "FRESH",
      confidence: 1,
    };
    if (!isAuthorizedWritePath(AUTHORIZED_WRITE_PATH)) {
      return { ok: false, path: AUTHORIZED_WRITE_PATH, kind, message: "write path not authorized" };
    }
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${AUTHORIZED_WRITE_PATH}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-actor-id": this.operator.id,
          "x-actor-kind": this.operator.kind,
        },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      if (!response.ok) {
        return {
          ok: false,
          path: AUTHORIZED_WRITE_PATH,
          kind,
          message: `gravação recusada (${response.status})`,
        };
      }
      void text;
      return {
        ok: true,
        path: AUTHORIZED_WRITE_PATH,
        kind,
        message: "gravado no Context Service",
      };
    } catch (err) {
      return {
        ok: false,
        path: AUTHORIZED_WRITE_PATH,
        kind,
        message: err instanceof Error ? err.message : "gravação indisponível",
      };
    }
  }

  private async loadPage(id: DestinationId): Promise<DestinationPage> {
    const fallback = fallbackProvenance(this.baseUrl || "relative", new Date().toISOString());
    if (id === "hoje") {
      return this.loadHoje(fallback);
    }
    if (id === "memoria") {
      return this.loadMemoria(fallback);
    }
    if (id === "agentes") {
      return this.loadAgentes(fallback);
    }
    return this.loadDomain(id, fallback);
  }

  private async loadHoje(fallback: Provenance): Promise<DestinationPage> {
    const paths = readPathsFor("hoje");
    const [today, attentionNow, attentionToday, snapshot, activities] = await Promise.all(
      paths.map((path) => this.getJson(path)),
    );
    const composeInput = mapHojePayloads({
      today,
      attentionNow,
      attentionToday,
      snapshot,
      activities,
      fallback,
    });
    return composePageFromHojeInput("hoje", this.readOperator(), composeInput);
  }

  private async loadMemoria(fallback: Provenance): Promise<DestinationPage> {
    if (!destinationUsesContext("memoria")) {
      throw new Error("memoria must use /v1/context");
    }
    const [path] = readPathsFor("memoria");
    const ctx = asRecord(await this.getJson(path!));
    if (!ctx) throw new Error("context payload is not an object");
    const dest = getDestination("memoria");
    const directives = mapContextDirectives(ctx, fallback);
    return {
      id: "memoria",
      label: dest.label,
      scope: dest.scope,
      generated_at: String(ctx.observed_at ?? fallback.observed_at),
      operator: this.readOperator(),
      headline: dest.description,
      attention: [],
      priorities: [],
      directives,
    };
  }

  private async loadAgentes(fallback: Provenance): Promise<DestinationPage> {
    const [path] = readPathsFor("agentes");
    const payload = await this.getJson(path!);
    const dest = getDestination("agentes");
    const activities = itemsOf(payload).map((row) => activityFrom(asRecord(row) ?? {}, fallback));
    return {
      id: "agentes",
      label: dest.label,
      scope: dest.scope,
      generated_at: fallback.observed_at,
      operator: this.readOperator(),
      headline: dest.description,
      attention: [],
      priorities: [],
      activities,
    };
  }

  private domainBody(payload: unknown, fallback: Provenance): Record<string, unknown> {
    const rec = asRecord(payload) ?? {};
    const slot = asRecord(rec.snapshot) ?? rec;
    const nested = asRecord(slot.snapshot);
    const body = { ...(nested ?? slot) };
    if (!body.freshness_status) body.freshness_status = slot.freshness_status ?? rec.freshness_status ?? fallback.freshness_status;
    if (!body.observed_at) body.observed_at = slot.observed_at ?? rec.generated_at ?? fallback.observed_at;
    if (!asRecord(body.source) && asRecord(slot.source)) body.source = slot.source;
    if (!asRecord(body.provenance)) {
      body.provenance = {
        source: body.source ?? slot.source ?? fallback.source,
        observed_at: body.observed_at,
        freshness_status: body.freshness_status,
        confidence: body.confidence ?? slot.confidence ?? fallback.confidence,
      };
    }
    return body;
  }

  private async loadDomain(id: DestinationId, fallback: Provenance): Promise<DestinationPage> {
    const paths = readPathsFor(id);
    const payloads = await Promise.all(paths.map((path) => this.getJson(path)));
    const payload = payloads[0];
    const dest = getDestination(id);
    const rec = asRecord(payload) ?? {};
    const inner = this.domainBody(payload, fallback);
    const page: DestinationPage = {
      id,
      label: dest.label,
      scope: dest.scope,
      generated_at: String(inner.generated_at ?? rec.generated_at ?? fallback.observed_at),
      operator: this.readOperator(),
      headline: dest.description,
      attention: [],
      priorities: [],
    };
    if (id === "comercial" || id === "crescimento") {
      page.commercial = commercialFrom(inner, fallback);
    }
    if (id === "crescimento" && payloads[1]) {
      const pncp = this.domainBody(payloads[1], fallback);
      page.health = [healthFrom(pncp, fallback)];
    } else if (id === "financeiro") {
      page.finance = financeFrom(inner, fallback);
    } else if (id === "engenharia") {
      page.engineering = engineeringFrom(inner, fallback);
    } else if (id === "clientes") {
      const list = itemsOf(inner.clients);
      const rows = list.length > 0 ? list : itemsOf(payload).length > 0 ? itemsOf(payload) : inner.schema_version ? [inner] : [];
      page.clients = rows.map((row) => clientFrom(asRecord(row) ?? {}, fallback));
    } else if (id === "infra") {
      const list = itemsOf(inner.services);
      const rows = list.length > 0 ? list : itemsOf(payload).length > 0 ? itemsOf(payload) : itemsOf(rec.health);
      page.health = (rows.length > 0 ? rows : inner.schema_version ? [inner] : []).map((row) =>
        healthFrom(asRecord(row) ?? {}, fallback),
      );
    }
    return page;
  }

  private async getJson(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const response = await this.fetchImpl(url, {
      headers: {
        accept: "application/json",
        "x-actor-id": this.operator.id,
        "x-actor-kind": this.operator.kind,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Backend operacional indisponível (${response.status} ${path}).`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Backend operacional devolveu JSON inválido em ${path}.`);
    }
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

/**
 * Production boot always constructs the HTTP adapter.
 * Mock is never selected here — only via explicit test injection in boot/mount.
 */
export function createProductionAdapter(): ControlCenterReadAdapter {
  const base = productionContextUrl() || "";
  return createHttpAdapter(base, undefined, productionActorFromDocument());
}
