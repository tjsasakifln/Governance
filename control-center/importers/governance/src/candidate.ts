import type { ClassifiedRecord } from "./classify.js";
import { candidateId, idempotencyKey } from "./idempotency.js";
import { scopeFromPath } from "./tree.js";
import {
  CANDIDATE_SCHEMA,
  IMPORTER_ACTOR_ID,
  SOURCE_SYSTEM,
  type ActorRef,
  type MemoryCandidate,
} from "./types.js";

export function buildCandidate(input: {
  record: ClassifiedRecord;
  index: number;
  sourcePath: string;
  contentHash: string;
  commitSha: string;
  observedAt: string;
}): MemoryCandidate {
  const { record, index, sourcePath, contentHash, commitSha, observedAt } = input;
  const key = idempotencyKey({
    sourcePath,
    kind: record.kind,
    index,
    contentHash,
    commitSha,
  });
  const createdBy: ActorRef = record.created_by_id
    ? actorFromId(record.created_by_id)
    : { kind: "system", id: IMPORTER_ACTOR_ID };
  const status = record.status;
  const effectiveFrom = record.effective_from ?? observedAt;
  const scope = record.scope ?? scopeFromPath(sourcePath);
  const confidence = confidenceFor(record.kind, record.tags);

  return {
    schema_version: CANDIDATE_SCHEMA,
    id: candidateId(key),
    idempotency_key: key,
    kind: record.kind,
    scope,
    status,
    title: record.title,
    body: record.body,
    effective_from: effectiveFrom,
    expires_at: record.expires_at,
    supersedes: record.supersedes,
    created_by: createdBy,
    created_at: observedAt,
    updated_at: observedAt,
    audit: [
      {
        at: observedAt,
        actor: { kind: "system", id: IMPORTER_ACTOR_ID },
        action: "created",
        to_status: status,
        note: "read-only projection of git source; git remains canonical",
      },
    ],
    source: {
      system: SOURCE_SYSTEM,
      kind: "git-file",
      locator: sourcePath,
      label: sourcePath.split("/").pop(),
    },
    observed_at: observedAt,
    freshness_status: "FRESH",
    confidence,
    content_hash: contentHash,
    source_path: sourcePath,
    commit_sha: commitSha,
    tags: record.tags,
  };
}

function actorFromId(id: string): ActorRef {
  if (id.startsWith("human:")) {
    return { kind: "human", id };
  }
  if (id.startsWith("agent:")) {
    return { kind: "agent", id };
  }
  if (id.startsWith("system:")) {
    return { kind: "system", id };
  }
  return { kind: "system", id: `system:${id}` };
}

function confidenceFor(kind: ClassifiedRecord["kind"], tags: string[]): number {
  if (tags.includes("explicit-json-kind") || tags.includes("explicit_json_kind")) {
    return 0.95;
  }
  if (tags.includes("explicit-markdown-heading") || tags.includes("explicit_markdown_heading")) {
    return 0.95;
  }
  if (kind === "hypothesis" || tags.includes("ambiguous_prose") || tags.includes("ambiguous-prose")) {
    return 0.35;
  }
  if (kind === "fact") {
    return 0.8;
  }
  return 0.7;
}
