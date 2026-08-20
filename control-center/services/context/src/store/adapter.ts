import type { AuditEvent, DirectiveRecord, ProposalRecord } from "../types.ts";

/**
 * Persistence contract expected from control-center/persistence at
 * convergence. This workstream ships a fixture implementation only.
 *
 * All methods are synchronous on the fixture store so policy tests can
 * run without I/O. A PostgreSQL adapter MUST provide the same semantics
 * and MUST write the audit event in the same commit as the mutation.
 */
export interface PersistenceAdapter {
  insertRevision(record: DirectiveRecord): void;
  getRevision(revisionId: string): DirectiveRecord | undefined;
  getCurrent(id: string): DirectiveRecord | undefined;
  listCurrent(): DirectiveRecord[];
  listRevisions(id: string): DirectiveRecord[];
  setCurrent(id: string, revisionId: string): void;
  appendAudit(event: AuditEvent): void;
  listAudit(): AuditEvent[];
  insertProposal(record: ProposalRecord): void;
  getProposal(id: string): ProposalRecord | undefined;
  listProposals(): ProposalRecord[];
  updateProposal(record: ProposalRecord): void;
}

export const ADAPTER_CONTRACT_VERSION = "control-center.context.persistence.v1";
