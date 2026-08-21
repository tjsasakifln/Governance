import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Persistence } from "@confenge/control-center-persistence";
import { createControlCenterPersistPort } from "../src/cc-db.js";
import {
  STAGING_RC_CANDIDATE_COUNT,
  parseArgv,
  runBootstrap,
} from "../src/bootstrap.js";
import { FIXED_NOW, FIXED_SHA, FIXTURE_ROOT } from "./helpers.js";
import type { ImportResult } from "../src/types.js";

const FAKE_TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

type FakeState = {
  keys: Set<string>;
  observations: number;
  directives: number;
  migrateCalls: number;
};

function fakePersistence(state: FakeState): Persistence {
  return {
    migrateUp: async () => {
      state.migrateCalls += 1;
      return [];
    },
    countObservationsByIdempotencyKey: async (key: string) => (state.keys.has(key) ? 1 : 0),
    recordObservation: async (input: { idempotencyKey: string }) => {
      state.keys.add(input.idempotencyKey);
      state.observations += 1;
      return { id: input.idempotencyKey };
    },
    createDirective: async () => {
      state.directives += 1;
      return { id: "cc:directive:fake" };
    },
  } as unknown as Persistence;
}

async function captureBootstrap(
  argv: string[],
  env: NodeJS.Dict<string> = {},
  deps?: Parameters<typeof runBootstrap>[3],
): Promise<{ code: number; stdout: string; stderr: string; parsed: Record<string, unknown> | null }> {
  let stdout = "";
  let stderr = "";
  const outcome = await runBootstrap(argv, env, {
    stdout: (line) => {
      stdout += `${line}\n`;
    },
    stderr: (line) => {
      stderr += `${line}\n`;
    },
  }, deps);
  let parsed: Record<string, unknown> | null = null;
  if (stdout.trim().length > 0) {
    try {
      parsed = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }
  return { code: outcome.code, stdout, stderr, parsed };
}

function asResult(parsed: Record<string, unknown> | null): ImportResult {
  assert.ok(parsed, "expected JSON stdout");
  return parsed as unknown as ImportResult;
}

describe("cc-governance-bootstrap shipped entry", () => {
  it("defaults to dry-run and accepts an explicit --dry-run flag", () => {
    const implicit = parseArgv(["--root", FIXTURE_ROOT]);
    assert.equal(implicit.apply, false);
    assert.equal(implicit.dryRun, false);
    assert.equal(implicit.allowControlCenterDbWrite, false);
    const explicit = parseArgv(["--dry-run", "--root", FIXTURE_ROOT]);
    assert.equal(explicit.dryRun, true);
    assert.equal(explicit.apply, false);
  });

  it("refuses --apply without --allow-control-center-db-write", async () => {
    const run = await captureBootstrap(
      [
        "--apply",
        "--root",
        FIXTURE_ROOT,
        "--now",
        FIXED_NOW.toISOString(),
        "--commit-sha",
        FIXED_SHA,
      ],
      { CONTROL_CENTER_DATABASE_URL: "postgres://example/cc" },
    );
    assert.equal(run.code, 2);
    assert.match(run.stderr, /CC_GOVERNANCE_IMPORTER_APPLY_NOT_ALLOWED/);
    assert.match(run.stderr, /allow-control-center-db-write/);
    assert.equal(run.parsed, null);
  });

  it("refuses conflicting --dry-run and --apply", async () => {
    const run = await captureBootstrap([
      "--dry-run",
      "--apply",
      "--allow-control-center-db-write",
      "--root",
      FIXTURE_ROOT,
    ]);
    assert.equal(run.code, 2);
    assert.match(run.stderr, /CONFLICTING_FLAGS/);
  });

  it("prints candidates with provenance and an unclassifiable report on dry-run twice", async () => {
    const argv = [
      "--dry-run",
      "--root",
      FIXTURE_ROOT,
      "--now",
      FIXED_NOW.toISOString(),
      "--commit-sha",
      FIXED_SHA,
    ];
    const first = await captureBootstrap(argv);
    const second = await captureBootstrap(argv);
    assert.equal(first.code, 0);
    assert.equal(second.code, 0);
    const a = asResult(first.parsed);
    const b = asResult(second.parsed);
    assert.equal(a.dry_run, true);
    assert.equal(a.persist, undefined);
    assert.ok(a.candidates.length >= 3);
    assert.ok(a.unclassifiable.length >= 1);
    assert.equal(a.stats.candidate_count, a.candidates.length);
    assert.notEqual(a.stats.candidate_count, STAGING_RC_CANDIDATE_COUNT);
    for (const candidate of a.candidates) {
      assert.ok(candidate.source_path.length > 0);
      assert.equal(candidate.commit_sha, FIXED_SHA);
      assert.match(candidate.content_hash, /^sha256:[0-9a-f]{64}$/);
    }
    assert.deepEqual(
      a.candidates.map((candidate) => candidate.idempotency_key),
      b.candidates.map((candidate) => candidate.idempotency_key),
    );
    const bootstrap = first.parsed?.["bootstrap"];
    assert.ok(bootstrap && typeof bootstrap === "object");
    const note = bootstrap as Record<string, unknown>;
    assert.equal(note["write_target"], "none");
    assert.equal(note["git_write"], false);
    assert.equal(note["provider_write"], false);
    const staging = note["staging_reference"] as Record<string, unknown>;
    assert.equal(staging["candidate_count"], 74);
    assert.equal(staging["contract"], false);
    const delta = note["staging_delta"] as Record<string, unknown>;
    assert.equal(typeof delta["explanation"], "string");
    assert.match(String(delta["explanation"]), /not a contract/i);
  });

  it("applies through the Control Center persist path and is idempotent on a second apply", async () => {
    const state: FakeState = { keys: new Set(), observations: 0, directives: 0, migrateCalls: 0 };
    const persistence = fakePersistence(state);
    const deps = {
      createPersist: (env: NodeJS.Dict<string>) =>
        createControlCenterPersistPort(
          { ...env, CONTROL_CENTER_DATABASE_URL: env.CONTROL_CENTER_DATABASE_URL ?? "postgres://cc/unused" },
          () => persistence,
        ),
    };
    const argv = [
      "--apply",
      "--allow-control-center-db-write",
      "--root",
      FIXTURE_ROOT,
      "--now",
      FIXED_NOW.toISOString(),
      "--commit-sha",
      FIXED_SHA,
    ];
    const env = { CONTROL_CENTER_DATABASE_URL: "postgres://cc/unused" };
    const first = await captureBootstrap(argv, env, deps);
    const second = await captureBootstrap(argv, env, deps);
    assert.equal(first.code, 0);
    assert.equal(second.code, 0);
    const firstResult = asResult(first.parsed);
    const secondResult = asResult(second.parsed);
    assert.equal(firstResult.dry_run, false);
    assert.equal(firstResult.persist?.target, "control-center-db");
    assert.equal(firstResult.persist?.inserted, firstResult.candidates.length);
    assert.equal(firstResult.persist?.skipped, 0);
    assert.equal(secondResult.persist?.inserted, 0);
    assert.equal(secondResult.persist?.skipped, firstResult.candidates.length);
    assert.equal(state.observations, firstResult.candidates.length);
    assert.equal(state.directives, firstResult.candidates.length);
    assert.ok(state.migrateCalls >= 2);
    const bootstrap = first.parsed?.["bootstrap"] as Record<string, unknown>;
    assert.equal(bootstrap["write_target"], "control-center-db");
    assert.equal(bootstrap["git_write"], false);
  });

  it("refuses apply when Control Center DB URL is missing and does not write Git", async () => {
    const before = readFileSync(join(FIXTURE_ROOT, "decisions", "ADR-SYNTHETIC-EXPLICIT-001.md"), "utf8");
    const run = await captureBootstrap(
      [
        "--apply",
        "--allow-control-center-db-write",
        "--root",
        FIXTURE_ROOT,
        "--now",
        FIXED_NOW.toISOString(),
        "--commit-sha",
        FIXED_SHA,
      ],
      {},
    );
    assert.equal(run.code, 1);
    assert.match(run.stderr, /CONTROL_CENTER_DATABASE_URL/);
    const after = readFileSync(join(FIXTURE_ROOT, "decisions", "ADR-SYNTHETIC-EXPLICIT-001.md"), "utf8");
    assert.equal(after, before);
  });

  it("classifies ambiguous prose as hypothesis and unlabeled decided prose is not a decision", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-bootstrap-prose-"));
    try {
      mkdirSync(join(root, "decisions"));
      mkdirSync(join(root, "commercial", "notes"), { recursive: true });
      writeFileSync(
        join(root, "decisions", "ADR-EXPLICIT.md"),
        "# Title\n\n**Status:** accepted\n\n## Decision\n\nDo the thing.\n",
      );
      writeFileSync(
        join(root, "commercial", "notes", "hallway.md"),
        "# hallway\n\nWe decided to ship tomorrow, probably.\n",
      );
      const run = await captureBootstrap([
        "--dry-run",
        "--root",
        root,
        "--now",
        FIXED_NOW.toISOString(),
        "--commit-sha",
        FIXED_SHA,
      ]);
      assert.equal(run.code, 0);
      const result = asResult(run.parsed);
      const kinds = Object.fromEntries(result.candidates.map((candidate) => [candidate.source_path, candidate.kind]));
      assert.equal(kinds["decisions/ADR-EXPLICIT.md"], "decision");
      assert.equal(kinds["commercial/notes/hallway.md"], "hypothesis");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports malformed source and missing SHA as unclassifiable without fabricating a SHA", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-bootstrap-malformed-"));
    try {
      mkdirSync(join(root, "commercial", "blobs"), { recursive: true });
      writeFileSync(join(root, "commercial", "blobs", "broken.json"), "{not-json");
      const missingSha = await captureBootstrap([
        "--dry-run",
        "--root",
        root,
        "--now",
        FIXED_NOW.toISOString(),
      ]);
      assert.equal(missingSha.code, 0);
      const missing = asResult(missingSha.parsed);
      assert.equal(missing.candidates.length, 0);
      assert.ok(missing.unclassifiable.length >= 1);
      for (const item of missing.unclassifiable) {
        assert.equal(item.reason, "missing_commit_sha");
        assert.equal(item.commit_sha, null);
        assert.notEqual(item.commit_sha, "unknown");
        assert.notEqual(item.commit_sha, FIXED_SHA);
      }

      const malformed = await captureBootstrap([
        "--dry-run",
        "--root",
        root,
        "--now",
        FIXED_NOW.toISOString(),
        "--commit-sha",
        FIXED_SHA,
      ]);
      assert.equal(malformed.code, 0);
      const broken = asResult(malformed.parsed).unclassifiable.find((item) =>
        item.source_path.endsWith("commercial/blobs/broken.json"),
      );
      assert.ok(broken);
      assert.equal(broken.reason, "invalid_json");
      assert.equal(broken.commit_sha, FIXED_SHA);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("scans secret/PII filenames and secret-shaped values and does not promote them", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-bootstrap-secret-"));
    try {
      mkdirSync(join(root, "commercial", "notes"), { recursive: true });
      mkdirSync(join(root, "commercial", "keys"), { recursive: true });
      writeFileSync(join(root, "commercial", "notes", "leaked.md"), `# note\n\ntoken ${FAKE_TOKEN}\n`);
      writeFileSync(join(root, "commercial", "keys", "id_rsa"), "-----BEGIN PRIVATE KEY-----\nMII\n-----END PRIVATE KEY-----\n");
      const run = await captureBootstrap([
        "--dry-run",
        "--root",
        root,
        "--now",
        FIXED_NOW.toISOString(),
        "--commit-sha",
        FIXED_SHA,
      ]);
      assert.equal(run.code, 0);
      const result = asResult(run.parsed);
      assert.equal(result.candidates.length, 0);
      const leaked = result.unclassifiable.find((item) => item.source_path.endsWith("commercial/notes/leaked.md"));
      assert.ok(leaked);
      assert.equal(leaked.reason, "secret_or_pii_content");
      const keyFile = result.unclassifiable.find((item) => item.source_path.includes("id_rsa"));
      assert.ok(keyFile);
      assert.ok(keyFile.reason === "secret_filename" || keyFile.reason === "secret_or_pii_content");
      assert.equal(run.stdout.includes("ghp_"), false);
      assert.doesNotMatch(run.stdout, /MII/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports partner-program / PR #8 paths and does not absorb them", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-bootstrap-partner-"));
    try {
      mkdirSync(join(root, "commercial", "partner-program"), { recursive: true });
      writeFileSync(
        join(root, "commercial", "partner-program", "governance-8.md"),
        "# Decision\n\nThis partner-program path must not be absorbed.\n",
      );
      const run = await captureBootstrap([
        "--dry-run",
        "--root",
        root,
        "--now",
        FIXED_NOW.toISOString(),
        "--commit-sha",
        FIXED_SHA,
      ]);
      assert.equal(run.code, 0);
      const result = asResult(run.parsed);
      assert.equal(result.candidates.length, 0);
      const item = result.unclassifiable.find((entry) => entry.source_path.includes("partner-program"));
      assert.ok(item);
      assert.equal(item.reason, "out_of_scope_partner_program");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
