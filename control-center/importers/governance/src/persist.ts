import type { ImportResult, PersistOutcome, PersistPort } from "./types.js";

export const PERSIST_DISABLED_CODE = "CC_GOVERNANCE_IMPORTER_PERSIST_DISABLED";

/**
 * Default persist port. Documented for later convergence; unused by the CLI.
 * Persistence lives in a sibling workstream and is not imported here.
 */
export function refusePersistPort(): PersistPort {
  return {
    async persistCandidates(_result: ImportResult): Promise<PersistOutcome> {
      throw new Error(
        `${PERSIST_DISABLED_CODE}: persist adapter is unused by default; dry-run only until the convergence campaign`,
      );
    },
  };
}

export function recordingPersistPort(sink: ImportResult[]): PersistPort {
  return {
    async persistCandidates(result: ImportResult): Promise<PersistOutcome> {
      sink.push(result);
      return { inserted: result.candidates.length, skipped: 0, target: "control-center-db" };
    },
  };
}
