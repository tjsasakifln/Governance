import type { DestinationId } from "../destinations";
import { getDestination } from "../destinations";
import { clientIdentityGapFrom } from "../client-identity";
import type {
  ActorRef,
  AttentionItem,
  ClientIdentityException,
  ClientStatus,
  PriorityRecommendation,
  Provenance,
} from "../types";
import {
  ADAPTER_ACTIONS,
  type AdapterAction,
  type AdapterReadResult,
  type AdapterWriteResult,
  type WarmblyDispatchInput,
  type ControlCenterReadAdapter,
  type DestinationPage,
} from "./contract";
import {
  activityFrom,
  asRecord,
  clientDataQualityFrom,
  maybeClientFrom,
  commercialFrom,
  composePageFromHojeInput,
  engineeringFrom,
  fallbackProvenance,
  financeFrom,
  healthFrom,
  itemsOf,
  mapContextDirectives,
  mapHojePayloads,
  provenanceOf,
} from "./map";
import {
  AUTHORIZED_WRITE_PATH,
  WARMBLY_DISPATCH_PATHS,
  WARMBLY_OPERATOR_LEDGER_PATH,
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
  lastOperatorResult?: AdapterWriteResult;
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

  async warmblyDispatch(input: WarmblyDispatchInput): Promise<AdapterWriteResult> {
    const path = WARMBLY_DISPATCH_PATHS[input.action];
    const fail = (message: string): AdapterWriteResult => {
      const denied: AdapterWriteResult = { ok: false, path: path ?? "/v1/warmbly/operator", kind: "nota", message };
      this.lastOperatorResult = denied;
      return denied;
    };
    if (!path) {
      return fail("ação de dispatch desconhecida");
    }
    // The channel refuses a write with no audit reason, and with paused_by
    // missing upstream this ledger is the only record of who did it.
    if (input.reason.trim() === "") {
      return fail("motivo é obrigatório");
    }
    if (input.action === "resume" && !input.confirmation_token) {
      return fail("resume exige o token de confirmação do passo anterior");
    }
    if (input.action === "acknowledge" && !input.target_id) {
      return fail("acknowledge exige o id do alerta");
    }
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        // No x-actor-id: identity is Authelia's, resolved at the edge from the
        // session. Sending an actor header here would invite trusting it.
        headers: { accept: "application/json", "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          reason: input.reason,
          ...(input.confirmation_token ? { confirmation_token: input.confirmation_token } : {}),
          ...(input.target_id ? { target_id: input.target_id } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const result: AdapterWriteResult = {
        ok: response.ok,
        path,
        kind: "nota",
        message: typeof body.reason === "string" ? body.reason : `HTTP ${response.status}`,
        ...(typeof body.confirmation_token === "string"
          ? { confirmationToken: body.confirmation_token }
          : {}),
      };
      this.lastOperatorResult = result;
      return result;
    } catch (err) {
      // A transport failure here says nothing about whether Warmbly applied the
      // change; the channel reports `unknown` for exactly this reason.
      return fail(`falha de transporte: ${err instanceof Error ? err.name : "erro"}`);
    }
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
      const denied: AdapterWriteResult = {
        ok: false,
        path: "/v1/operator-actions",
        kind: "nota",
        message: "ação comercial proibida",
      };
      this.lastOperatorResult = denied;
      return denied;
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
        const denied: AdapterWriteResult = {
          ok: false,
          path: "/v1/operator-actions",
          kind: "nota",
          message: `recusado (${response.status})`,
        };
        this.lastOperatorResult = denied;
        return denied;
      }
      const accepted: AdapterWriteResult = {
        ok: true,
        path: "/v1/operator-actions",
        kind: "nota",
        message: "reconhecido no Control Center; Warmbly não foi alterado",
      };
      this.lastOperatorResult = accepted;
      return accepted;
    } catch (err) {
      const failed: AdapterWriteResult = {
        ok: false,
        path: "/v1/operator-actions",
        kind: "nota",
        message: err instanceof Error ? err.message : "gravação indisponível",
      };
      this.lastOperatorResult = failed;
      return failed;
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
    if (id === "comercial" && page.commercial) {
      await this.attachLastOperatorAction(page.commercial);
    }
    if (id === "crescimento" && payloads[1]) {
      const pncp = this.domainBody(payloads[1], fallback);
      page.health = [healthFrom(pncp, fallback)];
    } else if (id === "financeiro") {
      page.finance = financeFrom(inner, fallback);
    } else if (id === "engenharia") {
      page.engineering = engineeringFrom(inner, fallback);
    } else if (id === "clientes") {
      // Only real client rows. The `[inner]` fallback that used to sit at the end
      // of this chain handed the *snapshot envelope* to the client mapper
      // whenever `clients` was absent or empty — which the shipped clients
      // snapshot is — and the mapper defaulted it into `client:unknown` /
      // "Cliente" / every source UNKNOWN: the card reported in issue #70.
      // A snapshot with no clients has no clients.
      const list = itemsOf(inner.clients);
      const rows = list.length > 0 ? list : itemsOf(payload);
      const clients: ClientStatus[] = [];
      const gaps: ClientIdentityException[] = [];
      rows.forEach((row, index) => {
        const rec = asRecord(row) ?? {};
        const client = maybeClientFrom(rec, fallback);
        if (client !== null) {
          clients.push(client);
          return;
        }
        // A published row that fails the identity rule is not dropped silently:
        // it joins the queue so the operator can see and correct it.
        gaps.push(clientIdentityGapFrom(rec, index, fallback));
      });
      page.clients = clients;
      // The producer's own queue is authoritative: it knows the origin, the
      // reason code and the correction. The reader must never invent them.
      page.client_data_quality = [...clientDataQualityFrom(inner, fallback), ...gaps];
    } else if (id === "infra") {
      const list = itemsOf(inner.services);
      const rows = list.length > 0 ? list : itemsOf(payload).length > 0 ? itemsOf(payload) : itemsOf(rec.health);
      // Per-service rows inherit the snapshot's provenance, not the adapter's
      // "nothing is known" default. Using the generic fallback printed every
      // card as UNKNOWN with confidence 0,00 while still echoing the row's own
      // "healthy" — the freshness of the snapshot the row came from is the
      // honest floor.
      const slotProvenance = provenanceOf(inner, fallback);
      page.health = (rows.length > 0 ? rows : inner.schema_version ? [inner] : []).map((row) =>
        healthFrom(asRecord(row) ?? {}, slotProvenance),
      );
    }
    return page;
  }

  /**
   * Attaches the last operator action to the commercial snapshot.
   *
   * Best effort on purpose: the channel is off by default and answers 404, and
   * a cockpit that cannot read its own audit trail must still render the
   * dispatch state. A miss leaves the field absent — which the surface renders
   * as "no action recorded in this instance", never as "nobody acted".
   */
  private async attachLastOperatorAction(commercial: { operations?: Record<string, unknown> }): Promise<void> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${WARMBLY_OPERATOR_LEDGER_PATH}`, {
        headers: { accept: "application/json" },
        credentials: "include",
      });
      if (!response.ok) return;
      const body = (await response.json()) as { entries?: unknown };
      const entries = Array.isArray(body.entries) ? body.entries : [];
      const latest = entries[0];
      if (!latest || typeof latest !== "object") return;
      const ops = (commercial.operations ??= {});
      ops.last_operator_action = latest;
    } catch {
      // Same reason as above: unreadable is not empty.
    }
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
