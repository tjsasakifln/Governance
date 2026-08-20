import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { importGovernance } from "../src/import.js";
import { contentHash } from "../src/hash.js";
import { recordingPersistPort } from "../src/persist.js";
import {
  AMBIGUOUS_PROSE,
  EXPLICIT_ADR,
  EXPLICIT_JSON,
  FIXED_NOW,
  FIXED_SHA,
  FIXTURE_ROOT,
  UNCLASSIFIABLE,
  fixtureBytes,
  fixtureGit,
  importFixtures,
} from "./helpers.js";
import type { ImportResult, MemoryCandidate } from "../src/types.js";

function sha256OfFile(absPath: string): string {
  const bytes = readFileSync(absPath);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function candidateFor(
  result: ImportResult,
  suffix: string,
): MemoryCandidate | undefined {
  return result.candidates.find((candidate) => candidate.source_path.endsWith(suffix));
}

describe("importGovernance shipped entry", () => {
  it("classifies an explicit labeled ADR Decision as decision", async () => {
    const result = await importFixtures();
    const adr = candidateFor(result, "decisions/ADR-SYNTHETIC-EXPLICIT-001.md");
    assert.ok(adr, "expected ADR candidate");
    assert.equal(adr.kind, "decision");
    assert.equal(adr.status, "active");
    assert.equal(adr.scope, "company");
    assert.match(adr.body, /projection of Git authority/);
    assert.equal(adr.commit_sha, FIXED_SHA);
    assert.equal(adr.content_hash, sha256OfFile(EXPLICIT_ADR));
    assert.equal(adr.source.system, "governance");
    assert.equal(adr.observed_at, FIXED_NOW.toISOString());
    assert.equal(adr.freshness_status, "FRESH");
    assert.ok(adr.confidence > 0.8);
    assert.ok(adr.audit.length >= 1);
    assert.equal(adr.created_by.kind, "system");
    assert.equal(adr.effective_from, "2026-08-20T00:00:00Z");
  });

  it("classifies an explicit JSON kind=decision record as decision", async () => {
    const result = await importFixtures();
    const json = candidateFor(result, "commercial/authority/synthetic-decision.v1.json");
    assert.ok(json);
    assert.equal(json.kind, "decision");
    assert.equal(json.scope, "commercial");
    assert.equal(json.content_hash, sha256OfFile(EXPLICIT_JSON));
  });

  it("classifies ambiguous prose as hypothesis and never as decision", async () => {
    const result = await importFixtures();
    const prose = candidateFor(result, "commercial/notes/ambiguous-prose.md");
    assert.ok(prose);
    assert.equal(prose.kind, "hypothesis");
    assert.notEqual(prose.kind, "decision");
    assert.match(prose.body, /hallway conversation/i);
    assert.equal(prose.content_hash, sha256OfFile(AMBIGUOUS_PROSE));
  });

  it("lists unclassifiable blobs in the report instead of upgrading them", async () => {
    const result = await importFixtures();
    const item = result.unclassifiable.find((entry) =>
      entry.source_path.endsWith("commercial/blobs/unclassifiable.json"),
    );
    assert.ok(item, "expected unclassifiable report entry");
    assert.equal(item.reason, "invalid_json");
    assert.equal(item.content_hash, sha256OfFile(UNCLASSIFIABLE));
    assert.equal(item.commit_sha, FIXED_SHA);
    const upgraded = result.candidates.find((candidate) =>
      candidate.source_path.endsWith("commercial/blobs/unclassifiable.json"),
    );
    assert.equal(upgraded, undefined);
  });

  it("attaches hash, source path, commit SHA, source, observed_at, freshness_status on every candidate", async () => {
    const result = await importFixtures();
    assert.ok(result.candidates.length >= 3);
    for (const candidate of result.candidates) {
      assert.match(candidate.content_hash, /^sha256:[0-9a-f]{64}$/);
      assert.ok(candidate.source_path.length > 0);
      assert.equal(candidate.commit_sha, FIXED_SHA);
      assert.equal(candidate.source.system, "governance");
      assert.equal(candidate.source.locator, candidate.source_path);
      assert.equal(candidate.observed_at, FIXED_NOW.toISOString());
      assert.equal(candidate.freshness_status, "FRESH");
      assert.ok(candidate.confidence >= 0 && candidate.confidence <= 1);
      assert.ok(candidate.scope);
      assert.ok(candidate.status);
      assert.ok(candidate.effective_from);
      assert.ok("expires_at" in candidate);
      assert.ok("supersedes" in candidate);
      assert.ok(candidate.created_by.id);
      assert.ok(candidate.audit.length >= 1);
    }
  });

  it("yields identical candidate ids, keys, and hashes across two runs of the same snapshot", async () => {
    const first = await importFixtures();
    const second = await importFixtures();
    assert.deepEqual(
      first.candidates.map((candidate) => ({
        id: candidate.id,
        idempotency_key: candidate.idempotency_key,
        kind: candidate.kind,
        content_hash: candidate.content_hash,
        commit_sha: candidate.commit_sha,
        source_path: candidate.source_path,
      })),
      second.candidates.map((candidate) => ({
        id: candidate.id,
        idempotency_key: candidate.idempotency_key,
        kind: candidate.kind,
        content_hash: candidate.content_hash,
        commit_sha: candidate.commit_sha,
        source_path: candidate.source_path,
      })),
    );
    assert.deepEqual(
      first.unclassifiable.map((item) => ({
        source_path: item.source_path,
        content_hash: item.content_hash,
        reason: item.reason,
      })),
      second.unclassifiable.map((item) => ({
        source_path: item.source_path,
        content_hash: item.content_hash,
        reason: item.reason,
      })),
    );
  });

  it("does not modify fixture source bytes", async () => {
    const before = {
      adr: sha256OfFile(EXPLICIT_ADR),
      json: sha256OfFile(EXPLICIT_JSON),
      prose: sha256OfFile(AMBIGUOUS_PROSE),
      blob: sha256OfFile(UNCLASSIFIABLE),
    };
    await importFixtures();
    assert.equal(sha256OfFile(EXPLICIT_ADR), before.adr);
    assert.equal(sha256OfFile(EXPLICIT_JSON), before.json);
    assert.equal(sha256OfFile(AMBIGUOUS_PROSE), before.prose);
    assert.equal(sha256OfFile(UNCLASSIFIABLE), before.blob);
    assert.equal(contentHash(fixtureBytes(EXPLICIT_ADR)), before.adr);
  });

  it("fail-closes missing commit SHA without fabricating one", async () => {
    const result = await importGovernance({
      root: FIXTURE_ROOT,
      now: FIXED_NOW,
      git: {
        commitShaFor: () => null,
        headSha: () => null,
      },
      dryRun: true,
    });
    assert.equal(result.candidates.length, 0);
    assert.ok(result.unclassifiable.length >= 1);
    for (const item of result.unclassifiable) {
      assert.equal(item.reason, "missing_commit_sha");
      assert.equal(item.commit_sha, null);
      assert.equal(item.freshness_status, "ERROR");
      assert.notEqual(item.commit_sha, "unknown");
      assert.notEqual(item.commit_sha, FIXED_SHA);
    }
  });

  it("does not invoke persist on the default dry-run path", async () => {
    const sink: ImportResult[] = [];
    const result = await importGovernance({
      root: FIXTURE_ROOT,
      now: FIXED_NOW,
      git: fixtureGit(),
      dryRun: true,
      persistEnabled: true,
      persist: recordingPersistPort(sink),
    });
    assert.equal(result.dry_run, true);
    assert.equal(sink.length, 0);
  });

  it("never infers decision from the word decided in unlabeled text", async () => {
    const result = await importGovernance({
      root: FIXTURE_ROOT,
      now: FIXED_NOW,
      git: fixtureGit(),
      files: [
        {
          path: "decisions/hallway-note.md",
          bytes: new TextEncoder().encode(
            "# hallway\n\nWe decided to ship tomorrow, probably.\n",
          ),
        },
      ],
      dryRun: true,
    });
    assert.equal(result.candidates.length, 1);
    const first = result.candidates[0];
    assert.ok(first);
    assert.equal(first.kind, "hypothesis");
  });
});
