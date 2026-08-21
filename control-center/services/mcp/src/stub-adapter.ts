import {
  clients,
  companyDumpSecret,
  companyState,
  contextRecords,
  decisions,
  directives,
  FIXTURE_CLIENTS,
  FIXTURE_SCOPES,
  priorities,
} from "./fixtures.js";
import type {
  BlockerInput,
  ClientContext,
  CompanyState,
  ContextApiPort,
  DecisionRecord,
  DirectiveRecord,
  PriorityRecord,
  ScopedContext,
  SessionResultInput,
  WriteReceipt,
} from "./types.js";

export class UnknownScopeError extends Error {
  override readonly name = "UnknownScopeError";
  constructor(public readonly scope: string) {
    super(`unknown scope: ${scope}`);
  }
}

export class UnknownClientError extends Error {
  override readonly name = "UnknownClientError";
  constructor(public readonly client: string) {
    super(`unknown client: ${client}`);
  }
}

function utcNow(): string {
  return new Date().toISOString();
}

function receipt(kind: WriteReceipt["kind"], id: string): WriteReceipt {
  const observed_at = utcNow();
  return {
    accepted: true,
    id,
    kind,
    recorded_at: observed_at,
    source: "mcp.agent-report",
    observed_at,
    freshness_status: "FRESH",
    confidence: 1,
  };
}

/**
 * Local Context API adapter backed by in-process fixtures.
 * No HTTP and no imports from sibling Control Center services.
 */
function inheritsCompany(requested: string, recordScope: string): boolean {
  return requested !== "company" && recordScope === "company";
}

export class StubContextApi implements ContextApiPort {
  private readonly sessionResults = new Map<string, WriteReceipt>();
  private readonly blockers = new Map<string, WriteReceipt>();
  private seq = 0;

  /** Intentionally unused by MCP tools — whole-company dump must never leak. */
  getInternalMemoryDump(): { id: string; body: string } {
    return companyDumpSecret;
  }

  async getCompanyState(): Promise<CompanyState> {
    return structuredClone(companyState);
  }

  async getContext(scope: string): Promise<ScopedContext> {
    if (!isFixtureScope(scope)) {
      throw new UnknownScopeError(scope);
    }
    const records = contextRecords.filter(
      (row) => row.scope === scope || inheritsCompany(scope, row.scope),
    );
    const first = records.find((row) => row.scope === scope) ?? records[0];
    return {
      scope,
      records: structuredClone(records),
      source: first?.source ?? "control-center.stub.fixtures",
      observed_at: first?.observed_at ?? utcNow(),
      freshness_status: first?.freshness_status ?? "UNKNOWN",
      confidence: first?.confidence,
    };
  }

  async getActiveDirectives(scope: string): Promise<DirectiveRecord[]> {
    if (!isFixtureScope(scope)) {
      throw new UnknownScopeError(scope);
    }
    return structuredClone(
      directives.filter(
        (row) =>
          row.status === "active" && (row.scope === scope || inheritsCompany(scope, row.scope)),
      ),
    );
  }

  async getPriorities(): Promise<PriorityRecord[]> {
    return structuredClone(priorities);
  }

  async getClientContext(client: string): Promise<ClientContext> {
    const found = clients[client];
    if (!found) {
      throw new UnknownClientError(client);
    }
    return structuredClone(found);
  }

  async getDecisions(since?: string): Promise<DecisionRecord[]> {
    const rows = structuredClone(decisions);
    if (since === undefined) {
      return rows;
    }
    const sinceMs = Date.parse(since);
    return rows.filter((row) => Date.parse(row.decided_at) >= sinceMs);
  }

  async reportSessionResult(input: SessionResultInput): Promise<WriteReceipt> {
    const idempotencyKey = input.session_id;
    if (idempotencyKey !== undefined) {
      const existing = this.sessionResults.get(idempotencyKey);
      if (existing) {
        return structuredClone(existing);
      }
    }
    this.seq += 1;
    const saved = receipt("session_result", `sr_${this.seq}`);
    if (idempotencyKey !== undefined) {
      this.sessionResults.set(idempotencyKey, saved);
    } else {
      this.sessionResults.set(saved.id, saved);
    }
    return structuredClone(saved);
  }

  async reportBlocker(input: BlockerInput): Promise<WriteReceipt> {
    const key = `${input.scope}|${input.summary}|${input.severity}|${String(input.blocking)}`;
    const existing = this.blockers.get(key);
    if (existing) {
      return structuredClone(existing);
    }
    this.seq += 1;
    const saved = receipt("blocker", `bl_${this.seq}`);
    this.blockers.set(key, saved);
    return structuredClone(saved);
  }
}

export function createStubContextApi(): StubContextApi {
  return new StubContextApi();
}

export function isFixtureScope(scope: string): boolean {
  return (FIXTURE_SCOPES as readonly string[]).includes(scope);
}

export function isFixtureClient(client: string): boolean {
  return (FIXTURE_CLIENTS as readonly string[]).includes(client);
}
