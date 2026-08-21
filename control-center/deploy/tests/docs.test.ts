import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PACK_ROOT } from "../src/paths.ts";

test("README and runbook document decisions, run, env, rollback, restore, and later wiring", () => {
  const readme = readFileSync(join(PACK_ROOT, "README.md"), "utf8");
  assert.match(readme, /## Decisions/);
  assert.match(readme, /## Run/);
  assert.match(readme, /## Environment/);
  assert.match(readme, /control-center\/persistence/);
  assert.match(readme, /control-center\/services\/context/);
  assert.match(readme, /control-center\/services\/mcp/);
  assert.match(readme, /control-center\/apps\/web-shell/);
  assert.match(readme, /CONTROL_CENTER_BACKUP_KEY/);
  assert.match(readme, /CONTROL_CENTER_DATABASE_URL/);
  assert.match(readme, /Warmbly/);
  assert.match(readme, /does \*\*not\*\* apply itself to production/);

  const runbook = readFileSync(join(PACK_ROOT, "RUNBOOK.md"), "utf8");
  assert.match(runbook, /## Deploy/);
  assert.match(runbook, /## Rollback/);
  assert.match(runbook, /## Restore/);
  assert.match(runbook, /## Backup/);
  assert.match(runbook, /America\/Sao_Paulo/);
  assert.match(runbook, /confenge-control-center-postgres/);
  assert.match(runbook, /disk-guard/);
  assert.match(runbook, /tls internal/);
});
