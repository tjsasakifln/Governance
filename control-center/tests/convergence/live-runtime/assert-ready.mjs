#!/usr/bin/env node
/**
 * Structured assertion over the live gate's JSON report.
 *
 * `run-gate.ts` already exits 2 when the gate is not ready, and CI runs it under
 * `set -o pipefail`, so a not-ready gate fails the step on its own. This adds a
 * second, non-scrapeable check: `grep -F READY_FOR_INTERNAL_PRODUCTION` matched
 * `"READY_FOR_INTERNAL_PRODUCTION": false` just as happily as `true`.
 */
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: assert-ready.mjs <live-gate-report.json>");
  process.exit(1);
}

const report = JSON.parse(readFileSync(path, "utf8"));

const failures = [];
if (report.READY_FOR_INTERNAL_PRODUCTION !== true) {
  failures.push(
    `READY_FOR_INTERNAL_PRODUCTION is ${JSON.stringify(report.READY_FOR_INTERNAL_PRODUCTION)}, expected true`,
  );
}
if (!Array.isArray(report.attacks) || report.attacks.length === 0) {
  failures.push("report carries no attacks[]");
} else {
  const notPass = report.attacks.filter((row) => row.state !== "pass");
  for (const row of notPass) {
    failures.push(`${row.attack_id}: ${row.state} — ${row.reason} ${JSON.stringify(row.evidence ?? {})}`);
  }
  const stale = report.attacks.find((row) => row.attack_id === "stale data mostrado como saudável");
  if (!stale) {
    failures.push("the stale-data-shown-as-healthy check did not run");
  }
}

if (failures.length > 0) {
  console.error("live QA gate is not ready:");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}

console.log(`READY_FOR_INTERNAL_PRODUCTION=true (${report.attacks.length} checks, all pass)`);
