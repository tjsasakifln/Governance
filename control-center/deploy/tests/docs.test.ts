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
  assert.match(readme, /PRODUCTION-RUNBOOK\.md/);
  assert.match(readme, /production-edge/);
  assert.match(readme, /stub pack/);

  const runbook = readFileSync(join(PACK_ROOT, "RUNBOOK.md"), "utf8");
  assert.match(runbook, /## Deploy/);
  assert.match(runbook, /## Rollback/);
  assert.match(runbook, /## Restore/);
  assert.match(runbook, /## Backup/);
  assert.match(runbook, /America\/Sao_Paulo/);
  assert.match(runbook, /confenge-control-center-postgres/);
  assert.match(runbook, /disk-guard/);
  assert.match(runbook, /tls internal/);
  assert.match(runbook, /PRODUCTION-RUNBOOK\.md/);
  assert.match(runbook, /Superseded for production apply/);

  const production = readFileSync(join(PACK_ROOT, "PRODUCTION-RUNBOOK.md"), "utf8");
  assert.match(production, /host nginx :443/);
  assert.match(production, /127\.0\.0\.1:18080/);
  assert.match(production, /forward_auth/);
  assert.match(production, /cc-postgres/);
  assert.match(production, /private \+ bearer/);
  assert.match(production, /confenge-control-center/);
  assert.match(production, /ops\.confenge\.com\.br/);
  assert.match(production, /auth\.ops\.confenge\.com\.br/);
  assert.doesNotMatch(production, /Never in this wave: SSH to Netcup/);
  assert.doesNotMatch(production, /this wave does not change live VPS/);
});
