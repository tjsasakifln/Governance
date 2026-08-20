import { assertAgent, assertFounder, assertReadable } from "./actor.ts";
import { toUtcIso, type Clock } from "./clock.ts";
import { conflict, invalid, notFound } from "./errors.ts";
import type { IdGenerator } from "./ids.ts";
import type { Logger } from "./log.ts";
import { compareDirectives, isActiveAt, isProtectedKind, partitionByKind, terminalStatus } from "./policy.ts";
import { parseScope, scopeVisibleUnderQuery, sortScope } from "./scope.ts";
import type { PersistenceAdapter } from "./store/adapter.ts";
import type {
  Actor,
  AuditEvent,
  ContextPayload,
  CreateDirectiveInput,
  DirectiveRecord,
  DirectiveView,
  ProposalRecord,
  Provenance,
  Scope,
} from "./types.ts";
import { parseCreateInput, parsePathId, parseProposalInput, parseVersionInput } from "./validate.ts";

export interface ContextServiceDeps {
  store: PersistenceAdapter;
  clock: Clock;
  ids: IdGenerator;
  founderActorId: string;
  logger: Logger;
  defaultCompany: string;
}

export interface ContextService {
  createDirective(actor: Actor, raw: unknown): DirectiveRecord;
  getDirective(actor: Actor, id: string): DirectiveRecord;
  listRevisions(actor: Actor, id: string): DirectiveRecord[];
  createVersion(actor: Actor, id: string, raw: unknown): DirectiveRecord;
  supersede(actor: Actor, id: string, raw: unknown): DirectiveRecord;
  expire(actor: Actor, id: string, raw?: unknown): DirectiveRecord;
  activate(actor: Actor, id: string): DirectiveRecord;
  deactivate(actor: Actor, id: string): DirectiveRecord;
  submitProposal(actor: Actor, raw: unknown): ProposalRecord;
  listProposals(actor: Actor): ProposalRecord[];
  rejectProposal(actor: Actor, id: string): ProposalRecord;
  getContext(actor: Actor, scope: Scope): ContextPayload;
  getActiveDirectives(actor: Actor, scope: Scope): DirectiveView[];
  getPriorities(actor: Actor, scope?: Scope): DirectiveView[];
  getDecisions(actor: Actor, scope?: Scope): DirectiveView[];
  listAudit(actor: Actor): AuditEvent[];
}

function provenanceFromInput(input: {
  source: string;
  observed_at?: string;
  freshness_status?: Provenance["freshness_status"];
  confidence?: number;
}): Provenance {
  if (!input.observed_at || !input.freshness_status) {
    throw invalid("provenance is incomplete");
  }
  const provenance: Provenance = {
    source: input.source,
    observed_at: input.observed_at,
    freshness_status: input.freshness_status,
  };
  if (input.confidence !== undefined) {
    provenance.confidence = input.confidence;
  }
  return provenance;
}

function toView(record: DirectiveRecord): DirectiveView {
  const view: DirectiveView = {
    id: record.id,
    revision_id: record.revision_id,
    version: record.version,
    kind: record.kind,
    title: record.title,
    body: record.body,
    scope: sortScope(record.scope),
    status: record.status,
    effective_from: record.effective_from,
    expires_at: record.expires_at,
    supersedes: record.supersedes,
    created_by: record.created_by,
    source: record.provenance.source,
    observed_at: record.provenance.observed_at,
    freshness_status: record.provenance.freshness_status,
  };
  if (record.provenance.confidence !== undefined) {
    view.confidence = record.provenance.confidence;
  }
  return view;
}

function viewsOf(records: readonly DirectiveRecord[]): DirectiveView[] {
  return [...records].sort(compareDirectives).map(toView);
}

export function createContextService(deps: ContextServiceDeps): ContextService {
  const founderActorId = deps.founderActorId.trim();
  if (!founderActorId) {
    throw invalid("CONTROL_CENTER_FOUNDER_ACTOR_ID is required");
  }

  const mustCurrent = (id: string): DirectiveRecord => {
    const current = deps.store.getCurrent(id);
    if (!current) {
      throw notFound("directive_not_found", "directive not found");
    }
    return current;
  };

  const writeAudit = (
    actor: Actor,
    action: string,
    entityType: AuditEvent["entity_type"],
    entityId: string,
    revisionId: string | null,
    metadata: AuditEvent["metadata"],
  ): void => {
    const event: AuditEvent = {
      id: deps.ids.next(),
      at: toUtcIso(deps.clock.now()),
      actor_id: actor.id,
      actor_role: actor.role,
      action,
      entity_type: entityType,
      entity_id: entityId,
      revision_id: revisionId,
      metadata,
    };
    deps.store.appendAudit(event);
    deps.logger.info(action, {
      entity_type: entityType,
      entity_id: entityId,
      actor_role: actor.role,
      kind: typeof metadata.kind === "string" ? metadata.kind : null,
    });
  };

  const insertCurrent = (record: DirectiveRecord): void => {
    deps.store.insertRevision(record);
    deps.store.setCurrent(record.id, record.revision_id);
  };

  const buildFromCreate = (actor: Actor, input: CreateDirectiveInput, id: string, version: number): DirectiveRecord => {
    const now = toUtcIso(deps.clock.now());
    return {
      id,
      revision_id: deps.ids.next(),
      version,
      kind: input.kind,
      title: input.title,
      body: input.body,
      scope: sortScope(input.scope),
      status: input.status ?? "active",
      effective_from: input.effective_from ?? now,
      expires_at: input.expires_at ?? null,
      supersedes: input.supersedes ?? null,
      created_by: actor.id,
      created_at: now,
      provenance: provenanceFromInput(input),
    };
  };

  const snapshot = (
    actor: Actor,
    current: DirectiveRecord,
    patch: Partial<Pick<DirectiveRecord, "title" | "body" | "status" | "effective_from" | "expires_at" | "supersedes">> & {
      provenance?: Provenance;
    },
  ): DirectiveRecord => {
    const now = toUtcIso(deps.clock.now());
    return {
      id: current.id,
      revision_id: deps.ids.next(),
      version: current.version + 1,
      kind: current.kind,
      title: patch.title ?? current.title,
      body: patch.body ?? current.body,
      scope: sortScope(current.scope),
      status: patch.status ?? current.status,
      effective_from: patch.effective_from ?? current.effective_from,
      expires_at: patch.expires_at !== undefined ? patch.expires_at : current.expires_at,
      supersedes: patch.supersedes !== undefined ? patch.supersedes : current.supersedes,
      created_by: actor.id,
      created_at: now,
      provenance: patch.provenance ?? current.provenance,
    };
  };

  const visibleActive = (scope: Scope): DirectiveRecord[] => {
    const now = deps.clock.now();
    return deps.store
      .listCurrent()
      .filter((rec) => isActiveAt(rec, now) && scopeVisibleUnderQuery(rec.scope, scope))
      .sort(compareDirectives);
  };

  const resolveScope = (scope?: Scope): Scope => {
    if (scope) {
      return parseScope(scope);
    }
    return parseScope({ company: deps.defaultCompany });
  };

  return {
    createDirective(actor: Actor, raw: unknown): DirectiveRecord {
      assertFounder(actor, founderActorId);
      const input = parseCreateInput(raw, deps.clock);
      const record = buildFromCreate(actor, input, deps.ids.next(), 1);
      insertCurrent(record);
      writeAudit(actor, "directive.create", "directive", record.id, record.revision_id, {
        kind: record.kind,
        version: record.version,
        scope: `${record.scope.company}/${record.scope.domain ?? ""}/${record.scope.resource ?? ""}`,
      });
      return record;
    },

    getDirective(actor: Actor, id: string): DirectiveRecord {
      assertReadable(actor, founderActorId);
      return mustCurrent(parsePathId(id, "id"));
    },

    listRevisions(actor: Actor, id: string): DirectiveRecord[] {
      assertReadable(actor, founderActorId);
      const parsed = parsePathId(id, "id");
      const revs = deps.store.listRevisions(parsed);
      if (revs.length === 0) {
        throw notFound("directive_not_found", "directive not found");
      }
      return revs;
    },

    createVersion(actor: Actor, id: string, raw: unknown): DirectiveRecord {
      assertFounder(actor, founderActorId);
      const current = mustCurrent(parsePathId(id, "id"));
      if (current.status === "superseded") {
        throw conflict("cannot version a superseded directive; create a successor via supersede");
      }
      const input = parseVersionInput(raw, deps.clock);
      const provenance: Provenance = {
        source: input.source ?? current.provenance.source,
        observed_at: input.observed_at ?? toUtcIso(deps.clock.now()),
        freshness_status: input.freshness_status ?? current.provenance.freshness_status,
      };
      if (input.confidence !== undefined && input.confidence !== null) {
        provenance.confidence = input.confidence;
      } else if (input.confidence !== null && current.provenance.confidence !== undefined) {
        provenance.confidence = current.provenance.confidence;
      }
      const patch: Partial<
        Pick<DirectiveRecord, "title" | "body" | "status" | "effective_from" | "expires_at" | "supersedes">
      > & { provenance?: Provenance } = { provenance };
      if (input.title !== undefined) {
        patch.title = input.title;
      }
      if (input.body !== undefined) {
        patch.body = input.body;
      }
      if (input.effective_from !== undefined) {
        patch.effective_from = input.effective_from;
      }
      if (input.expires_at !== undefined) {
        patch.expires_at = input.expires_at;
      }
      const next = snapshot(actor, current, patch);
      insertCurrent(next);
      writeAudit(actor, "directive.version", "directive", next.id, next.revision_id, {
        kind: next.kind,
        version: next.version,
      });
      return next;
    },

    supersede(actor: Actor, id: string, raw: unknown): DirectiveRecord {
      assertFounder(actor, founderActorId);
      const current = mustCurrent(parsePathId(id, "id"));
      if (current.status === "superseded") {
        throw conflict("directive is already superseded");
      }
      const input = parseCreateInput(raw, deps.clock);
      const closed = snapshot(actor, current, { status: "superseded" });
      insertCurrent(closed);
      writeAudit(actor, "directive.supersede", "directive", closed.id, closed.revision_id, {
        kind: closed.kind,
        version: closed.version,
        successor_pending: true,
      });
      const successorInput: CreateDirectiveInput = {
        ...input,
        supersedes: current.id,
      };
      const successor = buildFromCreate(actor, successorInput, deps.ids.next(), 1);
      insertCurrent(successor);
      writeAudit(actor, "directive.create", "directive", successor.id, successor.revision_id, {
        kind: successor.kind,
        version: successor.version,
        supersedes: current.id,
      });
      return successor;
    },

    expire(actor: Actor, id: string, raw?: unknown): DirectiveRecord {
      assertFounder(actor, founderActorId);
      const current = mustCurrent(parsePathId(id, "id"));
      if (current.status === "superseded") {
        throw conflict("cannot expire a superseded directive");
      }
      let expiresAt = toUtcIso(deps.clock.now());
      if (raw !== undefined && raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
        const obj = raw as Record<string, unknown>;
        if (obj.expires_at !== undefined && obj.expires_at !== null) {
          if (typeof obj.expires_at !== "string") {
            throw invalid("expires_at must be an ISO-8601 UTC timestamp");
          }
          expiresAt = toUtcIso(new Date(obj.expires_at));
        }
      }
      const next = snapshot(actor, current, { status: "expired", expires_at: expiresAt });
      insertCurrent(next);
      writeAudit(actor, "directive.expire", "directive", next.id, next.revision_id, {
        kind: next.kind,
        version: next.version,
      });
      return next;
    },

    activate(actor: Actor, id: string): DirectiveRecord {
      assertFounder(actor, founderActorId);
      const current = mustCurrent(parsePathId(id, "id"));
      if (terminalStatus(current.status)) {
        throw conflict("cannot activate a superseded or expired directive");
      }
      const next = snapshot(actor, current, { status: "active" });
      insertCurrent(next);
      writeAudit(actor, "directive.activate", "directive", next.id, next.revision_id, {
        kind: next.kind,
        version: next.version,
      });
      return next;
    },

    deactivate(actor: Actor, id: string): DirectiveRecord {
      assertFounder(actor, founderActorId);
      const current = mustCurrent(parsePathId(id, "id"));
      if (terminalStatus(current.status)) {
        throw conflict("cannot deactivate a superseded or expired directive");
      }
      const next = snapshot(actor, current, { status: "inactive" });
      insertCurrent(next);
      writeAudit(actor, "directive.deactivate", "directive", next.id, next.revision_id, {
        kind: next.kind,
        version: next.version,
      });
      return next;
    },

    submitProposal(actor: Actor, raw: unknown): ProposalRecord {
      assertAgent(actor, founderActorId);
      const input = parseProposalInput(raw, deps.clock);
      if (input.target_directive_id) {
        const target = deps.store.getCurrent(input.target_directive_id);
        if (!target) {
          throw notFound("directive_not_found", "target directive not found");
        }
        if (isProtectedKind(target.kind) && input.action !== "create") {
          deps.logger.warn("proposal.protected_target", {
            actor_role: actor.role,
            kind: target.kind,
            action: input.action,
          });
        }
      }
      if (isProtectedKind(input.kind) && (input.action === "supersede" || input.action === "expire" || input.action === "deactivate" || input.action === "version")) {
        // Accepted as a suggestion only; never applied here.
        deps.logger.warn("proposal.protected_kind", {
          actor_role: actor.role,
          kind: input.kind,
          action: input.action,
        });
      }
      const record: ProposalRecord = {
        id: deps.ids.next(),
        status: "pending",
        action: input.action,
        kind: input.kind,
        title: input.title,
        body: input.body,
        scope: sortScope(input.scope),
        target_directive_id: input.target_directive_id ?? null,
        rationale: input.rationale,
        created_by: actor.id,
        created_at: toUtcIso(deps.clock.now()),
        provenance: provenanceFromInput(input),
      };
      deps.store.insertProposal(record);
      writeAudit(actor, "proposal.submit", "proposal", record.id, null, {
        kind: record.kind,
        action: record.action,
        target: record.target_directive_id,
      });
      return record;
    },

    listProposals(actor: Actor): ProposalRecord[] {
      assertReadable(actor, founderActorId);
      const all = deps.store.listProposals();
      if (actor.role === "agent") {
        return all.filter((p) => p.created_by === actor.id);
      }
      return all;
    },

    rejectProposal(actor: Actor, id: string): ProposalRecord {
      assertFounder(actor, founderActorId);
      const current = deps.store.getProposal(parsePathId(id, "id"));
      if (!current) {
        throw notFound("proposal_not_found", "proposal not found");
      }
      const next: ProposalRecord = { ...current, status: "rejected" };
      deps.store.updateProposal(next);
      writeAudit(actor, "proposal.reject", "proposal", next.id, null, {
        kind: next.kind,
        action: next.action,
      });
      return next;
    },

    getContext(actor: Actor, scope: Scope): ContextPayload {
      assertReadable(actor, founderActorId);
      const query = parseScope(scope);
      const active = visibleActive(query);
      const parts = partitionByKind(active);
      return {
        scope: sortScope(query),
        active_directives: viewsOf(active),
        decisions: viewsOf(parts.decisions),
        facts: viewsOf(parts.facts),
        constraints: viewsOf(parts.constraints),
        priorities: viewsOf(parts.priorities),
        risks: viewsOf(parts.risks),
        directives: viewsOf(parts.directives),
        hypotheses: viewsOf(parts.hypotheses),
      };
    },

    getActiveDirectives(actor: Actor, scope: Scope): DirectiveView[] {
      assertReadable(actor, founderActorId);
      return viewsOf(visibleActive(parseScope(scope)));
    },

    getPriorities(actor: Actor, scope?: Scope): DirectiveView[] {
      assertReadable(actor, founderActorId);
      const query = resolveScope(scope);
      return viewsOf(visibleActive(query).filter((r) => r.kind === "priority"));
    },

    getDecisions(actor: Actor, scope?: Scope): DirectiveView[] {
      assertReadable(actor, founderActorId);
      const query = resolveScope(scope);
      return viewsOf(visibleActive(query).filter((r) => r.kind === "decision"));
    },

    listAudit(actor: Actor): AuditEvent[] {
      assertFounder(actor, founderActorId);
      return deps.store.listAudit();
    },
  };
}
