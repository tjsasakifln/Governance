import {
  createPersistence,
  createPool,
  type Persistence,
} from "@confenge/control-center-persistence";
import type { ImportResult, MemoryCandidate, PersistOutcome, PersistPort } from "./types.js";

function databaseUrl(env: NodeJS.Dict<string>): string {
  const url = env.CONTROL_CENTER_DATABASE_URL ?? env.DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new Error("CONTROL_CENTER_DATABASE_URL is required for --apply");
  }
  return url.trim();
}

export function createControlCenterPersistPort(
  env: NodeJS.Dict<string> = process.env,
  persistenceFactory?: (url: string) => Persistence,
): PersistPort {
  return {
    async persistCandidates(result: ImportResult): Promise<PersistOutcome> {
      const url = databaseUrl(env);
      const persistence = persistenceFactory
        ? persistenceFactory(url)
        : createPersistence(createPool(url));
      await persistence.migrateUp();
      let inserted = 0;
      let skipped = 0;
      for (const candidate of result.candidates) {
        const count = await persistence.countObservationsByIdempotencyKey(candidate.idempotency_key);
        if (count > 0) {
          skipped += 1;
          continue;
        }
        await persistCandidate(persistence, candidate);
        inserted += 1;
      }
      return { inserted, skipped, target: "control-center-db" };
    },
  };
}

async function persistCandidate(persistence: Persistence, candidate: MemoryCandidate): Promise<void> {
  await persistence.recordObservation({
    scope: candidate.scope,
    observationKind: `governance-import.${candidate.kind}`,
    payload: {
      candidate_id: candidate.id,
      title: candidate.title,
      body: candidate.body,
      status: candidate.status,
      source_path: candidate.source_path,
      commit_sha: candidate.commit_sha,
      content_hash: candidate.content_hash,
    },
    idempotencyKey: candidate.idempotency_key,
    source: candidate.source,
    observedAt: new Date(candidate.observed_at),
    freshnessStatus: candidate.freshness_status,
    confidence: candidate.confidence,
  });
  await persistence.createDirective({
    id: candidate.id,
    kind: candidate.kind,
    scope: candidate.scope,
    status: "draft",
    title: candidate.title,
    body: candidate.body,
    effectiveFrom: new Date(candidate.effective_from),
    expiresAt: candidate.expires_at ? new Date(candidate.expires_at) : null,
    createdBy: `${candidate.created_by.kind}:${candidate.created_by.id}`,
    supersedes: candidate.supersedes ?? [],
    source: candidate.source,
    observedAt: new Date(candidate.observed_at),
    freshnessStatus: candidate.freshness_status,
    confidence: candidate.confidence,
  });
}
