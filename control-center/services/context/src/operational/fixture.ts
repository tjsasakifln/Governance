import { OperationalUnavailableError } from "./errors.ts";
import type { OperationalReadPort } from "./port.ts";
import type {
  CollectorRunRow,
  OperationalReadResult,
  OperationalSnapshotRow,
  SourceObservationRow,
} from "./types.ts";

export interface OperationalFixtureData {
  collector_runs?: CollectorRunRow[];
  source_observations?: SourceObservationRow[];
  operational_snapshots?: OperationalSnapshotRow[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createFixtureOperationalPort(data: OperationalFixtureData = {}): OperationalReadPort {
  const snapshot: OperationalReadResult = {
    collector_runs: clone(data.collector_runs ?? []),
    source_observations: clone(data.source_observations ?? []),
    operational_snapshots: clone(data.operational_snapshots ?? []),
  };
  return {
    async readLatest(): Promise<OperationalReadResult> {
      return clone(snapshot);
    },
  };
}

export function createUnavailableOperationalPort(message = "database unavailable"): OperationalReadPort {
  return {
    async readLatest(): Promise<OperationalReadResult> {
      throw new OperationalUnavailableError(message);
    },
  };
}
