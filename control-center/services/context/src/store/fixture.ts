import type {
  AgentActivityRecord,
  AuditEvent,
  DirectiveProposal,
  DirectiveRecord,
  Provenance,
} from "../types.ts";
import type { PersistencePort } from "./adapter.ts";

function cloneProvenance(provenance: Provenance): Provenance {
  const cloned: Provenance = {
    source: { ...provenance.source },
    observed_at: provenance.observed_at,
    freshness_status: provenance.freshness_status,
    confidence: provenance.confidence,
  };
  if (provenance.freshness_window_seconds !== undefined) {
    cloned.freshness_window_seconds = provenance.freshness_window_seconds;
  }
  return cloned;
}

function cloneDirective(record: DirectiveRecord): DirectiveRecord {
  return {
    ...record,
    supersedes: record.supersedes ? [...record.supersedes] : null,
    created_by: { ...record.created_by },
    provenance: cloneProvenance(record.provenance),
  };
}

function cloneAudit(event: AuditEvent): AuditEvent {
  return { ...event, actor: { ...event.actor }, metadata: { ...event.metadata } };
}

function cloneProposal(record: DirectiveProposal): DirectiveProposal {
  return {
    ...record,
    created_by: { ...record.created_by },
    provenance: cloneProvenance(record.provenance),
  };
}

export function createFixtureStore(): PersistencePort {
  const revisions = new Map<string, DirectiveRecord>();
  const current = new Map<string, string>();
  const audits: AuditEvent[] = [];
  const proposals = new Map<string, DirectiveProposal>();
  const activities: AgentActivityRecord[] = [];

  return {
    insertRevision(record: DirectiveRecord): void {
      if (revisions.has(record.revision_id)) {
        throw new Error(`duplicate revision_id ${record.revision_id}`);
      }
      revisions.set(record.revision_id, cloneDirective(record));
    },
    getRevision(revisionId: string): DirectiveRecord | undefined {
      const found = revisions.get(revisionId);
      return found ? cloneDirective(found) : undefined;
    },
    getCurrent(id: string): DirectiveRecord | undefined {
      const revisionId = current.get(id);
      if (!revisionId) {
        return undefined;
      }
      const found = revisions.get(revisionId);
      return found ? cloneDirective(found) : undefined;
    },
    listCurrent(): DirectiveRecord[] {
      const out: DirectiveRecord[] = [];
      for (const revisionId of current.values()) {
        const found = revisions.get(revisionId);
        if (found) {
          out.push(cloneDirective(found));
        }
      }
      return out;
    },
    listRevisions(id: string): DirectiveRecord[] {
      const out: DirectiveRecord[] = [];
      for (const rec of revisions.values()) {
        if (rec.id === id) {
          out.push(cloneDirective(rec));
        }
      }
      out.sort((a, b) => a.version - b.version);
      return out;
    },
    setCurrent(id: string, revisionId: string): void {
      if (!revisions.has(revisionId)) {
        throw new Error(`unknown revision_id ${revisionId}`);
      }
      current.set(id, revisionId);
    },
    appendAudit(event: AuditEvent): void {
      audits.push(cloneAudit(event));
    },
    listAudit(): AuditEvent[] {
      return audits.map(cloneAudit);
    },
    insertProposal(record: DirectiveProposal): void {
      if (proposals.has(record.id)) {
        throw new Error(`duplicate proposal id ${record.id}`);
      }
      proposals.set(record.id, cloneProposal(record));
    },
    getProposal(id: string): DirectiveProposal | undefined {
      const found = proposals.get(id);
      return found ? cloneProposal(found) : undefined;
    },
    listProposals(): DirectiveProposal[] {
      return [...proposals.values()].map(cloneProposal);
    },
    updateProposal(record: DirectiveProposal): void {
      if (!proposals.has(record.id)) {
        throw new Error(`unknown proposal ${record.id}`);
      }
      proposals.set(record.id, cloneProposal(record));
    },
    recordAgentActivity(record: AgentActivityRecord): void {
      const idx = activities.findIndex((row) => row.correlation_id === record.correlation_id);
      const cloned: AgentActivityRecord = {
        ...record,
        payload: { ...record.payload },
        actor: { ...record.actor },
        provenance: cloneProvenance(record.provenance),
      };
      if (idx >= 0) {
        activities[idx] = cloned;
      } else {
        activities.push(cloned);
      }
    },
    listAgentActivities(): AgentActivityRecord[] {
      return activities.map((row) => ({
        ...row,
        payload: { ...row.payload },
        actor: { ...row.actor },
        provenance: cloneProvenance(row.provenance),
      }));
    },
  };
}
