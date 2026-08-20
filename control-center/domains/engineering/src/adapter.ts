import { z, type ZodError } from "zod";
import {
  COLLECTOR_ENGINEERING_SNAPSHOT_SCHEMA,
  COLLECTOR_FRESHNESS,
  UTC_DATETIME_PATTERN,
} from "./constants.js";
import { EngineeringError } from "./errors.js";
import type {
  CollectorEngineeringSnapshot,
  CollectorError,
  CollectorRepoSnapshot,
} from "./types.js";

const utc = z
  .string()
  .regex(
    UTC_DATETIME_PATTERN,
    "timestamp must be RFC3339 UTC with a Z suffix",
  );

const freshness = z.enum(COLLECTOR_FRESHNESS);

const collectorProvenance = z.object({
  source: z.string().min(1),
  observed_at: utc,
  freshness_status: freshness,
  confidence: z.number().min(0).max(1).optional(),
});

function requireProvenance<T extends z.ZodRawShape>(shape: T) {
  return collectorProvenance.extend(shape);
}

const repoIdentity = requireProvenance({
  observation_id: z.string().min(1),
  owner: z.string().min(1),
  name: z.string().min(1),
  full_name: z.string().min(1),
  default_branch: z.string().min(1),
  html_url: z.string().min(1),
  pushed_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  last_activity_at: z.string().nullable(),
});

const commit = requireProvenance({
  observation_id: z.string().min(1),
  repo: z.string().min(1),
  sha: z.string().min(1),
  message: z.string(),
  committed_at: z.string().nullable(),
  author_login: z.string().nullable(),
});

const issue = requireProvenance({
  observation_id: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().nonnegative(),
  title: z.string().min(1),
  state: z.string().min(1),
  labels: z.array(z.string()),
  priority: z.string().nullable(),
  html_url: z.string().min(1),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

const pullRequest = requireProvenance({
  observation_id: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string().min(1),
  draft: z.boolean(),
  created_at: utc,
  age_seconds: z.number().int().nonnegative(),
  review_status: z.string().min(1),
  check_status: z.string().min(1),
  html_url: z.string().min(1),
  updated_at: z.string().nullable(),
  head_sha: z.string().nullable(),
  head_ref: z.string().nullable(),
  base_ref: z.string().nullable(),
});

const checkFailure = requireProvenance({
  observation_id: z.string().min(1),
  repo: z.string().min(1),
  kind: z.enum(["check_run", "workflow_run"]),
  remote_id: z.number().int(),
  name: z.string().min(1),
  conclusion: z.string().nullable(),
  html_url: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  head_sha: z.string().nullable(),
});

const collectionError = requireProvenance({
  observation_id: z.string().min(1),
  repo: z.string().nullable(),
  resource: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  http_status: z.number().int().nullable(),
});

const supportedDivergence = requireProvenance({
  observation_id: z.string().min(1),
  repo: z.string().min(1),
  base: z.string().min(1),
  head: z.string().min(1),
  support: z.literal("supported"),
  ahead_by: z.number().int(),
  behind_by: z.number().int(),
  status: z.string().min(1),
});

const unsupportedDivergence = requireProvenance({
  observation_id: z.string().min(1),
  repo: z.string().min(1),
  base: z.string().nullable(),
  head: z.string().nullable(),
  support: z.enum(["unsupported", "unavailable"]),
  ahead_by: z.null(),
  behind_by: z.null(),
  status: z.enum(["unsupported", "unavailable"]),
  reason: z.string().min(1),
});

const okCollection = z.object({
  ok: z.literal(true),
  freshness_status: z.enum(["fresh", "not_modified"]),
});

const failedCollection = z.object({
  ok: z.literal(false),
  freshness_status: z.enum(["failed", "stale"]),
  error_observation_id: z.string().min(1),
});

const skippedCollection = z.object({
  skipped: z.literal(true),
});

const repoSnapshot = z.object({
  repo: repoIdentity.nullable(),
  repo_collection: z.union([okCollection, failedCollection]),
  issues_collection: z.union([okCollection, failedCollection, skippedCollection]),
  recent_commits: z.array(commit),
  open_issues: z.array(issue),
  open_pull_requests: z.array(pullRequest),
  check_failures: z.array(checkFailure),
  workflow_failures: z.array(checkFailure),
  divergence: z.union([supportedDivergence, unsupportedDivergence]),
  errors: z.array(collectionError),
});

const snapshotSchema = requireProvenance({
  schema: z.literal(COLLECTOR_ENGINEERING_SNAPSHOT_SCHEMA),
  snapshot_id: z.string().min(1),
  collected_at: utc,
  allowlist: z.array(z.string().min(1)),
  repos: z.array(repoSnapshot),
  errors: z.array(collectionError),
});

function formatZod(error: ZodError): string {
  const first = error.issues[0];
  if (!first) {
    return "collector snapshot is invalid";
  }
  const path = first.path.join(".") || "(root)";
  return `${path}: ${first.message}`;
}

function isMissingProvenance(error: ZodError): boolean {
  return error.issues.some((issue) => {
    const last = issue.path[issue.path.length - 1];
    return (
      last === "source" ||
      last === "observed_at" ||
      last === "freshness_status"
    );
  });
}

export function parseCollectorSnapshot(input: unknown): CollectorEngineeringSnapshot {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new EngineeringError(
      "invalid_input",
      "collector snapshot must be an object",
    );
  }
  const rec = input as Record<string, unknown>;
  if (
    rec.source === undefined ||
    rec.observed_at === undefined ||
    rec.freshness_status === undefined
  ) {
    throw new EngineeringError(
      "missing_provenance",
      "collector snapshot is missing source, observed_at, or freshness_status",
    );
  }

  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success) {
    if (isMissingProvenance(parsed.error)) {
      throw new EngineeringError("missing_provenance", formatZod(parsed.error));
    }
    throw new EngineeringError("invalid_input", formatZod(parsed.error));
  }
  return parsed.data;
}

export function assembleCollectorSnapshots(
  inputs: readonly unknown[],
): CollectorEngineeringSnapshot {
  if (inputs.length === 0) {
    throw new EngineeringError(
      "invalid_input",
      "assembleCollectorSnapshots requires at least one snapshot",
    );
  }
  const parsed = inputs.map((item) => parseCollectorSnapshot(item));
  const first = parsed[0];
  if (!first) {
    throw new EngineeringError("invalid_input", "assembleCollectorSnapshots is empty");
  }

  const repos: CollectorRepoSnapshot[] = [];
  const allowlist: string[] = [];
  const errors: CollectorError[] = [];
  const seenRepos = new Set<string>();
  const seenAllow = new Set<string>();

  let freshness = first.freshness_status;
  let confidence: number | undefined = first.confidence;

  for (const snap of parsed) {
    for (const name of snap.allowlist) {
      if (!seenAllow.has(name)) {
        seenAllow.add(name);
        allowlist.push(name);
      }
    }
    for (const repo of snap.repos) {
      const key =
        repo.repo?.full_name ??
        repo.errors.find((err) => err.repo)?.repo ??
        `idx:${repos.length}`;
      if (seenRepos.has(key)) {
        continue;
      }
      seenRepos.add(key);
      repos.push(repo);
    }
    errors.push(...snap.errors);
    if (snap.freshness_status === "failed") {
      freshness = "failed";
      confidence = 0;
    } else if (freshness !== "failed" && snap.freshness_status === "stale") {
      freshness = "stale";
      confidence = Math.min(confidence ?? 0.4, snap.confidence ?? 0.4);
    }
  }

  const assembled: CollectorEngineeringSnapshot = {
    schema: COLLECTOR_ENGINEERING_SNAPSHOT_SCHEMA,
    snapshot_id: "github:engineering_snapshot:assembled",
    collected_at: first.collected_at,
    allowlist,
    repos,
    errors,
    source: first.source,
    observed_at: first.observed_at,
    freshness_status: freshness,
  };
  if (confidence !== undefined) {
    assembled.confidence = confidence;
  }
  return parseCollectorSnapshot(assembled);
}
