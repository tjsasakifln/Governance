import type { AuditEvent, DirectiveRecord, ProposalRecord } from "../types.ts";
import type { PersistenceAdapter } from "./adapter.ts";

function cloneDirective(record: DirectiveRecord): DirectiveRecord {
  return {
    ...record,
    scope: { ...record.scope },
    provenance: { ...record.provenance },
  };
}

function cloneAudit(event: AuditEvent): AuditEvent {
  return { ...event, metadata: { ...event.metadata } };
}

function cloneProposal(record: ProposalRecord): ProposalRecord {
  return {
    ...record,
    scope: { ...record.scope },
    provenance: { ...record.provenance },
  };
}

export function createFixtureStore(): PersistenceAdapter {
  const revisions = new Map<string, DirectiveRecord>();
  const current = new Map<string, string>();
  const audits: AuditEvent[] = [];
  const proposals = new Map<string, ProposalRecord>();

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
    insertProposal(record: ProposalRecord): void {
      if (proposals.has(record.id)) {
        throw new Error(`duplicate proposal id ${record.id}`);
      }
      proposals.set(record.id, cloneProposal(record));
    },
    getProposal(id: string): ProposalRecord | undefined {
      const found = proposals.get(id);
      return found ? cloneProposal(found) : undefined;
    },
    listProposals(): ProposalRecord[] {
      return [...proposals.values()].map(cloneProposal);
    },
    updateProposal(record: ProposalRecord): void {
      if (!proposals.has(record.id)) {
        throw new Error(`unknown proposal ${record.id}`);
      }
      proposals.set(record.id, cloneProposal(record));
    },
  };
}
