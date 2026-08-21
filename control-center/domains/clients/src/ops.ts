import type {
  AttentionItem,
  ClientStatus,
  DueCommitmentItem,
  OpenBlockerItem,
} from "./contract.js";
import { resolveClock, type Clock } from "./clock.js";
import { ingestClientStatus } from "./ingest.js";
import {
  DEFAULT_DUE_HORIZON_HOURS,
  queryAttention,
  queryDueCommitments,
  queryOpenBlockers,
} from "./queries.js";
import { parseScope } from "./scope.js";
import { InMemoryClientStore, type ClientStatusRepository } from "./store.js";

export interface CreateClientOpsOptions {
  now?: Date | Clock;
  store?: ClientStatusRepository;
}

export interface QueryArgs {
  scope?: string;
  horizonHours?: number;
}

export interface ClientOps {
  ingest(raw: unknown): ClientStatus;
  queryAttention(args?: QueryArgs): AttentionItem[];
  queryDueCommitments(args?: QueryArgs): DueCommitmentItem[];
  queryOpenBlockers(args?: QueryArgs): OpenBlockerItem[];
  getClient(clientSlug: string): ClientStatus | undefined;
  list(scope?: string): ClientStatus[];
}

/**
 * In-process client-ops facade. Homepage and MCP should call these queries
 * (not own client data) after convergence.
 */
export function createClientOps(options: CreateClientOpsOptions = {}): ClientOps {
  const clock = resolveClock(options.now);
  const store = options.store ?? new InMemoryClientStore();

  return {
    ingest(raw: unknown): ClientStatus {
      return ingestClientStatus(raw, { now: clock(), store });
    },
    queryAttention(args: QueryArgs = {}): AttentionItem[] {
      return queryAttention({ now: clock(), records: store.list(), scope: args.scope });
    },
    queryDueCommitments(args: QueryArgs = {}): DueCommitmentItem[] {
      return queryDueCommitments({
        now: clock(),
        records: store.list(),
        scope: args.scope,
        horizonHours: args.horizonHours ?? DEFAULT_DUE_HORIZON_HOURS,
      });
    },
    queryOpenBlockers(args: QueryArgs = {}): OpenBlockerItem[] {
      return queryOpenBlockers({ now: clock(), records: store.list(), scope: args.scope });
    },
    getClient(clientSlug: string): ClientStatus | undefined {
      parseScope(`client:${clientSlug}`);
      return store.getBySlug(clientSlug);
    },
    list(scope?: string): ClientStatus[] {
      const parsed = parseScope(scope);
      return store.list().filter((item) => {
        if (parsed.kind === "all") {
          return true;
        }
        return item.client_slug === parsed.clientSlug;
      });
    },
  };
}
