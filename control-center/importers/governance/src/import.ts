import { classifyFile } from "./classify.js";
import { buildCandidate } from "./candidate.js";
import { resolveCommitSha } from "./git.js";
import { contentHash } from "./hash.js";
import { createLogger, type StructuredLogger } from "./log.js";
import { refusePersistPort } from "./persist.js";
import {
  DEFAULT_RELATIVE_ROOTS,
  fromVirtual,
  isDeniedPath,
  walkDisk,
  type ScannedFile,
} from "./tree.js";
import {
  DIRECTIVE_KINDS,
  IMPORT_RESULT_SCHEMA,
  type DirectiveKind,
  type GitMetadataProvider,
  type ImportResult,
  type MemoryCandidate,
  type PersistPort,
  type UnclassifiableItem,
  type VirtualSourceFile,
} from "./types.js";
import { assertValidResult } from "./validate.js";

export type ImportOptions = {
  root: string;
  now?: Date;
  git: GitMetadataProvider;
  files?: readonly VirtualSourceFile[];
  relativeRoots?: readonly string[];
  dryRun?: boolean;
  persistEnabled?: boolean;
  persist?: PersistPort;
  log?: StructuredLogger;
};

function emptyByKind(): Record<DirectiveKind, number> {
  return {
    decision: 0,
    directive: 0,
    fact: 0,
    constraint: 0,
    priority: 0,
    risk: 0,
    hypothesis: 0,
  };
}

export async function importGovernance(options: ImportOptions): Promise<ImportResult> {
  const now = options.now ?? new Date();
  const observedAt = now.toISOString();
  const dryRun = options.dryRun !== false;
  const persistEnabled = options.persistEnabled === true;
  const log = options.log ?? createLogger();
  const relativeRoots = options.relativeRoots ?? DEFAULT_RELATIVE_ROOTS;

  const scanned: ScannedFile[] = options.files
    ? fromVirtual(options.files)
    : walkDisk(options.root, relativeRoots);

  const candidates: MemoryCandidate[] = [];
  const unclassifiable: UnclassifiableItem[] = [];

  log("governance_import_start", {
    root: options.root,
    dry_run: dryRun,
    files_scanned: scanned.length,
    persist_enabled: persistEnabled,
  });

  for (const file of scanned) {
    const denied = file.skipReason ?? isDeniedPath(file.path);
    const hash = contentHash(file.bytes);
    if (denied) {
      unclassifiable.push({
        source_path: file.path,
        content_hash: hash,
        commit_sha: null,
        reason: denied,
        observed_at: observedAt,
        freshness_status: "ERROR",
      });
      continue;
    }

    const commitSha = resolveCommitSha(options.git, file.path);
    if (commitSha === null) {
      unclassifiable.push({
        source_path: file.path,
        content_hash: hash,
        commit_sha: null,
        reason: "missing_commit_sha",
        observed_at: observedAt,
        freshness_status: "ERROR",
      });
      continue;
    }

    const classification = classifyFile(file.path, file.bytes);
    if (!classification.classifiable) {
      unclassifiable.push({
        source_path: file.path,
        content_hash: hash,
        commit_sha: commitSha,
        reason: classification.reason,
        observed_at: observedAt,
        freshness_status: "FRESH",
      });
      continue;
    }

    classification.records.forEach((record, index) => {
      candidates.push(
        buildCandidate({
          record,
          index,
          sourcePath: file.path,
          contentHash: hash,
          commitSha,
          observedAt,
        }),
      );
    });
  }

  candidates.sort(compareCandidates);
  unclassifiable.sort((a, b) => a.source_path.localeCompare(b.source_path));

  const byKind = emptyByKind();
  for (const candidate of candidates) {
    const current = byKind[candidate.kind];
    byKind[candidate.kind] = current + 1;
  }

  const result: ImportResult = {
    schema_version: IMPORT_RESULT_SCHEMA,
    dry_run: dryRun,
    observed_at: observedAt,
    repo_root: options.root,
    files_scanned: scanned.length,
    candidates,
    unclassifiable,
    stats: {
      candidate_count: candidates.length,
      unclassifiable_count: unclassifiable.length,
      by_kind: byKind,
    },
  };

  assertValidResult(result);

  log("governance_import_complete", {
    dry_run: dryRun,
    candidate_count: result.stats.candidate_count,
    unclassifiable_count: result.stats.unclassifiable_count,
    kinds: DIRECTIVE_KINDS.filter((kind) => byKind[kind] > 0),
  });

  if (!dryRun && persistEnabled) {
    const persist = options.persist ?? refusePersistPort();
    await persist.persistCandidates(result);
  }

  return result;
}

function compareCandidates(a: MemoryCandidate, b: MemoryCandidate): number {
  if (a.source_path !== b.source_path) {
    return a.source_path.localeCompare(b.source_path);
  }
  return a.id.localeCompare(b.id);
}
