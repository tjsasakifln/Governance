import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { parseBackupKey, writeEncryptedBackup } from "../src/backup.ts";
import { pruneBackupDir } from "../src/retention.ts";
import { FIXTURE_DUMP } from "../src/paths.ts";
import { tempDir, testKey } from "./helpers.ts";

test("retention prune removes expired copies and keeps current plus the minimum newest", () => {
  const fixture = readFileSync(FIXTURE_DUMP);
  const key = parseBackupKey(testKey());
  const dir = tempDir("cc-retain-");
  const current = writeEncryptedBackup({
    plaintext: fixture,
    key,
    outDir: dir,
    observedAt: "2026-08-20T06:00:00Z",
  });
  const recent = writeEncryptedBackup({
    plaintext: fixture,
    key,
    outDir: dir,
    observedAt: "2026-08-18T06:00:00Z",
  });
  const expired = writeEncryptedBackup({
    plaintext: fixture,
    key,
    outDir: dir,
    observedAt: "2026-07-01T06:00:00Z",
  });
  const alsoExpired = writeEncryptedBackup({
    plaintext: fixture,
    key,
    outDir: dir,
    observedAt: "2026-06-01T06:00:00Z",
  });

  const result = pruneBackupDir(dir, new Date("2026-08-20T12:00:00Z"), 14, 3);
  assert.equal(existsSync(current.encPath), true);
  assert.equal(existsSync(recent.encPath), true);
  assert.equal(existsSync(expired.encPath), true);
  assert.equal(existsSync(alsoExpired.encPath), false);
  assert.equal(existsSync(alsoExpired.metaPath), false);
  assert.ok(result.kept.includes(current.encPath));
  assert.ok(result.dropped.includes(alsoExpired.encPath));
  assert.equal(result.kept.length, 3);
  assert.equal(result.dropped.length, 1);

  const second = pruneBackupDir(dir, new Date("2026-08-20T12:00:00Z"), 1, 2);
  assert.equal(existsSync(current.encPath), true);
  assert.equal(existsSync(recent.encPath), true);
  assert.equal(existsSync(expired.encPath), false);
  assert.equal(second.kept.length, 2);
});
