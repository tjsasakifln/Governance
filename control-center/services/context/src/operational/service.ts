import { assertOperationalReader } from "../actor.ts";
import type { Clock } from "../clock.ts";
import { invalid } from "../errors.ts";
import type { RepoDomainMap } from "../scope.ts";
import { parseScope } from "../scope.ts";
import type { ActorRef, Scope } from "../types.ts";
import { assembleEnvelope, type AssembleDeps } from "./assemble.ts";
import {
  buildCommercialListResponse,
  type CommercialListId,
  type CommercialListResponse,
} from "./commercial-list.ts";
import type { OperationalReadPort } from "./port.ts";
import {
  OPERATIONAL_DOMAINS,
  type AttentionHorizon,
  type OperationalAttentionResponse,
  type OperationalDomain,
  type OperationalDomainResponse,
  type OperationalEnvelope,
  type OperationalObservationsResponse,
  type OperationalTodayResponse,
} from "./types.ts";

export interface OperationalServiceDeps {
  port: OperationalReadPort;
  clock: Clock;
  founderActorId: string;
  repoDomains: RepoDomainMap;
}

export interface OperationalService {
  getEnvelope(actor: ActorRef, scope: Scope): Promise<OperationalEnvelope>;
  getDomain(actor: ActorRef, domain: string, scope: Scope): Promise<OperationalDomainResponse>;
  getAttention(actor: ActorRef, scope: Scope, horizon: AttentionHorizon): Promise<OperationalAttentionResponse>;
  getToday(actor: ActorRef, scope: Scope): Promise<OperationalTodayResponse>;
  getSourceObservations(actor: ActorRef, scope: Scope, source?: string): Promise<OperationalObservationsResponse>;
  getCommercialList(
    actor: ActorRef,
    scope: Scope,
    list: CommercialListId,
    params: Readonly<Record<string, string>>,
  ): Promise<CommercialListResponse>;
}

function parseDomain(raw: string): OperationalDomain {
  if (!(OPERATIONAL_DOMAINS as readonly string[]).includes(raw)) {
    throw invalid(`domain must be one of: ${OPERATIONAL_DOMAINS.join(", ")}`);
  }
  return raw as OperationalDomain;
}

export function createOperationalService(deps: OperationalServiceDeps): OperationalService {
  const assembleDeps: AssembleDeps = {
    port: deps.port,
    clock: deps.clock,
    repoDomains: deps.repoDomains,
  };

  const envelopeFor = async (actor: ActorRef, scope: Scope): Promise<OperationalEnvelope> => {
    assertOperationalReader(actor, deps.founderActorId);
    return assembleEnvelope(assembleDeps, parseScope(scope));
  };

  return {
    async getEnvelope(actor, scope) {
      return envelopeFor(actor, scope);
    },

    async getDomain(actor, domainRaw, scope) {
      const domain = parseDomain(domainRaw);
      const envelope = await envelopeFor(actor, scope);
      const snapshot = envelope.snapshots[domain];
      return {
        schema_version: envelope.schema_version,
        scope: envelope.scope,
        generated_at: envelope.generated_at,
        freshness_status: snapshot?.freshness_status ?? envelope.freshness_status,
        confidence: snapshot?.confidence ?? 0,
        domain,
        snapshot,
      };
    },

    async getAttention(actor, scope, horizon) {
      const envelope = await envelopeFor(actor, scope);
      const items = horizon === "now" ? envelope.attention_now : envelope.today;
      const body: OperationalAttentionResponse = {
        schema_version: envelope.schema_version,
        scope: envelope.scope,
        generated_at: envelope.generated_at,
        freshness_status: envelope.freshness_status,
        confidence: envelope.confidence,
        horizon,
        items,
      };
      if (envelope.audit) {
        body.audit = envelope.audit;
      }
      return body;
    },

    async getToday(actor, scope) {
      const query = parseScope(scope);
      if (query !== "company") {
        throw invalid("GET /v1/today requires scope=company");
      }
      const envelope = await envelopeFor(actor, query);
      const body: OperationalTodayResponse = {
        schema_version: envelope.schema_version,
        scope: "company",
        generated_at: envelope.generated_at,
        freshness_status: envelope.freshness_status,
        confidence: envelope.confidence,
        today: envelope.today.slice(0, 3),
      };
      if (envelope.audit) {
        body.audit = envelope.audit;
      }
      return body;
    },

    async getSourceObservations(actor, scope, source) {
      const envelope = await envelopeFor(actor, scope);
      let items = envelope.source_observations;
      if (source !== undefined && source !== null && source !== "") {
        const system = source.trim();
        if (!/^[a-z][a-z0-9-]*$/.test(system)) {
          throw invalid("source must be a lowercase kebab source system");
        }
        items = items.filter((row) => row.source.system === system);
      }
      return {
        schema_version: envelope.schema_version,
        scope: envelope.scope,
        generated_at: envelope.generated_at,
        freshness_status: envelope.freshness_status,
        confidence: envelope.confidence,
        source_observations: items,
      };
    },

    async getCommercialList(actor, scope, list, params) {
      assertOperationalReader(actor, deps.founderActorId);
      const query = parseScope(scope);
      const bundle = await deps.port.readLatest();
      return buildCommercialListResponse(bundle, query, deps.repoDomains, list, params, deps.clock.now());
    },
  };
}
