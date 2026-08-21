import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createPersistence } from "@confenge/control-center-persistence";
import { startIsolatedTestPostgres } from "../../persistence/tests/helpers/postgres.ts";
import { createControlCenterPersistPort } from "../../importers/governance/src/cc-db.ts";
import { runCli } from "../../importers/governance/src/cli.ts";
import { importGovernance } from "../../importers/governance/src/import.ts";
import { injectedGit } from "../../importers/governance/src/git.ts";

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../importers/governance/fixtures/synthetic-repo",
);
const NOW = new Date("2026-08-20T12:00:00.000Z");
const SHA = "a".repeat(40);

test("dry-run writes zero Control Center DB rows", async () => {
  const pg = await startIsolatedTestPostgres();
  try {
    const persistence = createPersistence(pg.pool);
    await persistence.migrateUp();
    const before = await pg.pool.query("select count(*)::int as n from control_center.source_observations");
    let stdout = "";
    const outcome = await runCli(
      ["--root", fixtureRoot, "--now", NOW.toISOString(), "--commit-sha", SHA],
      { CONTROL_CENTER_DATABASE_URL: "postgres://unused/unused" },
      { stdout: (line) => { stdout += line; }, stderr: () => undefined },
    );
    assert.equal(outcome.code, 0);
    const parsed = JSON.parse(stdout) as { dry_run: boolean };
    assert.equal(parsed.dry_run, true);
    const after = await pg.pool.query("select count(*)::int as n from control_center.source_observations");
    assert.equal(before.rows[0].n, 0);
    assert.equal(after.rows[0].n, 0);
  } finally {
    await pg.stop();
  }
});

test("opt-in apply twice is idempotent and writes only the Control Center database", async () => {
  const pg = await startIsolatedTestPostgres();
  try {
    const persistence = createPersistence(pg.pool);
    const persist = createControlCenterPersistPort(
      { CONTROL_CENTER_DATABASE_URL: "postgres://cc/cc" },
      () => persistence,
    );
    const git = injectedGit(SHA);
    const first = await importGovernance({
      root: fixtureRoot,
      now: NOW,
      git,
      dryRun: false,
      persistEnabled: true,
      persist,
    });
    assert.equal(first.dry_run, false);
    assert.ok(first.candidates.length >= 1);
    const afterFirst = await pg.pool.query("select count(*)::int as n from control_center.source_observations");
    const directivesFirst = await pg.pool.query("select count(*)::int as n from control_center.directives");
    assert.equal(afterFirst.rows[0].n, first.candidates.length);
    assert.equal(directivesFirst.rows[0].n, first.candidates.length);

    const second = await importGovernance({
      root: fixtureRoot,
      now: NOW,
      git,
      dryRun: false,
      persistEnabled: true,
      persist,
    });
    const afterSecond = await pg.pool.query("select count(*)::int as n from control_center.source_observations");
    const directivesSecond = await pg.pool.query("select count(*)::int as n from control_center.directives");
    assert.equal(afterSecond.rows[0].n, afterFirst.rows[0].n);
    assert.equal(directivesSecond.rows[0].n, directivesFirst.rows[0].n);
    assert.equal(second.candidates.length, first.candidates.length);

    const hosts = await pg.pool.query(
      `select payload::text as body from control_center.source_observations`,
    );
    for (const row of hosts.rows as Array<{ body: string }>) {
      assert.equal(row.body.includes("warmbly"), false);
      assert.equal(row.body.includes("asaas"), false);
    }
  } finally {
    await pg.stop();
  }
});
