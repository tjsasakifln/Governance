import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../../importers/governance/src/cli.ts";

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../importers/governance/fixtures/synthetic-repo",
);

test("importer default is dry-run and writes zero CC DB rows", async () => {
  let stdout = "";
  const outcome = await runCli(
    ["--root", fixtureRoot, "--now", "2026-08-20T12:00:00.000Z", "--commit-sha", "a".repeat(40)],
    {},
    { stdout: (line) => { stdout += line; }, stderr: () => undefined },
  );
  assert.equal(outcome.code, 0);
  const parsed = JSON.parse(stdout) as { dry_run: boolean; candidates: unknown[] };
  assert.equal(parsed.dry_run, true);
  assert.ok(parsed.candidates.length >= 1);
  assert.match(stdout, /source/);
});

test("importer --persist stays refused", async () => {
  const stderr: string[] = [];
  const outcome = await runCli(["--root", fixtureRoot, "--persist"], {}, {
    stdout: () => undefined,
    stderr: (line) => stderr.push(line),
  });
  assert.equal(outcome.code, 2);
  assert.match(stderr.join("\n"), /PERSIST_DISABLED/);
});
