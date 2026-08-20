import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FIXTURE_DUMP } from "../src/paths.ts";
import { runCli, tempDir, testKey } from "./helpers.ts";

test("validate CLI entry succeeds twice and names compose, volume, caddy, backup, disk guard", () => {
  const first = runCli(["validate"], { CONTROL_CENTER_APPLY_PRODUCTION: "false" });
  const second = runCli(["validate"], { CONTROL_CENTER_APPLY_PRODUCTION: "false" });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  for (const out of [first.stdout, second.stdout]) {
    assert.match(out, /project=confenge-control-center/);
    assert.match(out, /postgres_volume=confenge-control-center-postgres/);
    assert.match(out, /caddy_hook=reverse_proxy/);
    assert.match(out, /backup=encrypted-aes-256-gcm/);
    assert.match(out, /restore=fixture-drill/);
    assert.match(out, /retention=age-and-min-count/);
    assert.match(out, /disk_guard=fail-closed/);
  }
  const blocked = runCli(["validate"], { CONTROL_CENTER_APPLY_PRODUCTION: "true" });
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /refuses to apply to production/);
});

test("restore-drill CLI entry restores the fixture twice with ciphertext != plaintext", () => {
  const key = testKey();
  const outDir = tempDir("cc-drill-");
  const result = runCli(["restore-drill", "--out", outDir], {
    CONTROL_CENTER_BACKUP_KEY: key,
    CONTROL_CENTER_DISK_MIN_BYTES: "1",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /restore-drill ok/);
  const fixture = readFileSync(FIXTURE_DUMP);
  const run1 = readFileSync(join(outDir, "run-1", "restored.dump.sql"));
  const run2 = readFileSync(join(outDir, "run-2", "restored.dump.sql"));
  assert.equal(Buffer.compare(run1, fixture), 0);
  assert.equal(Buffer.compare(run2, fixture), 0);
  for (const run of ["run-1", "run-2"]) {
    const backups = join(outDir, run, "backups");
    const encName = readdirSync(backups).find((name) => name.endsWith(".dump.enc"));
    assert.ok(encName, `${run} missing ciphertext`);
    const enc = readFileSync(join(backups, encName));
    assert.notEqual(Buffer.compare(enc, fixture), 0);
    assert.equal(enc.includes(Buffer.from("CC_FIXTURE_SENTINEL_9f3c2a7b1e44")), false);
  }
  const drill = JSON.parse(readFileSync(join(outDir, "drill-summary.json"), "utf8")) as {
    sameContent: boolean;
    fixtureBytes: number;
  };
  assert.equal(drill.sameContent, true);
  assert.equal(drill.fixtureBytes, fixture.length);
});
