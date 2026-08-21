import type { AgentActivityRecord, AuditEvent, DirectiveProposal, DirectiveRecord } from "../types.ts";

/**
 * Persistence port. Production uses the Postgres adapter in `./postgres.ts`.
 * The fixture store is test-only. A PostgreSQL adapter MUST provide the same
 * semantics and MUST write the audit event in the same commit as the mutation.
 *
 * `src/store/expected-schema.sql` is a test-only contract snapshot of
 * these records. The service MUST NOT load or apply that file.
 */
export interface PersistencePort {
  insertRevision(record: DirectiveRecord): void;
  getRevision(revisionId: string): DirectiveRecord | undefined;
  getCurrent(id: string): DirectiveRecord | undefined;
  listCurrent(): DirectiveRecord[];
  listRevisions(id: string): DirectiveRecord[];
  setCurrent(id: string, revisionId: string): void;
  appendAudit(event: AuditEvent): void;
  listAudit(): AuditEvent[];
  insertProposal(record: DirectiveProposal): void;
  getProposal(id: string): DirectiveProposal | undefined;
  listProposals(): DirectiveProposal[];
  updateProposal(record: DirectiveProposal): void;
  recordAgentActivity(record: AgentActivityRecord): void;
  listAgentActivities(): AgentActivityRecord[];
  flush?(): Promise<void>;
  readyCheck?(): Promise<boolean>;
}

/** @deprecated Use PersistencePort. */
export type PersistenceAdapter = PersistencePort;

export const ADAPTER_CONTRACT_VERSION = "control-center.context.persistence.v1";
