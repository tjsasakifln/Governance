import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  decryptDump,
  encryptDump,
  parseBackupKey,
  restoreEncryptedBackup,
  verifyEncryptedBackup,
  writeEncryptedBackup,
} from "../src/backup.ts";
import { FailClosedError } from "../src/fail-closed.ts";
import { FIXTURE_DUMP } from "../src/paths.ts";
import { runBackupPipeline } from "../src/pipeline.ts";
import { tempDir, testKey } from "./helpers.ts";

test("backup encrypt/verify/restore round-trip drives shipped functions on the fixture dump", () => {
  const fixture = readFileSync(FIXTURE_DUMP);
  assert.ok(fixture.includes("CC_FIXTURE_SENTINEL_9f3c2a7b1e44"));
  const key = parseBackupKey(testKey());
  const ciphertext = encryptDump(fixture, key);
  assert.notEqual(ciphertext.equals(fixture), true);
  assert.equal(ciphertext.includes(Buffer.from("CC_FIXTURE_SENTINEL_9f3c2a7b1e44")), false);
  const plain = decryptDump(ciphertext, key);
  assert.equal(Buffer.compare(plain, fixture), 0);

  const outDir = tempDir("cc-backup-");
  const written = writeEncryptedBackup({
    plaintext: fixture,
    key,
    outDir,
    observedAt: "2026-08-20T06:00:00Z",
    source: "control-center.deploy.fixture",
  });
  assert.equal(written.meta.source, "control-center.deploy.fixture");
  assert.equal(written.meta.observed_at, "2026-08-20T06:00:00Z");
  assert.equal(written.meta.freshness_status, "fresh");
  assert.equal(written.meta.confidence, 1);
  const onDisk = readFileSync(written.encPath);
  assert.notEqual(Buffer.compare(onDisk, fixture), 0);
  const verified = verifyEncryptedBackup(written.encPath, key);
  assert.equal(Buffer.compare(verified, fixture), 0);
  const restoredPath = join(outDir, "restored.dump.sql");
  const restored = restoreEncryptedBackup(written.encPath, key, restoredPath);
  assert.equal(Buffer.compare(restored, fixture), 0);
  assert.equal(Buffer.compare(readFileSync(restoredPath), fixture), 0);
});

test("backup pipeline fails closed without a key, on placeholders, and on unencrypted blobs", () => {
  const fixture = readFileSync(FIXTURE_DUMP);
  const outDir = tempDir("cc-backup-fail-");
  assert.throws(
    () =>
      runBackupPipeline({
        plaintext: fixture,
        keyRaw: undefined,
        outDir,
        observedAt: "2026-08-20T06:00:00Z",
        minBytesRaw: "1",
      }),
    FailClosedError,
  );
  assert.throws(() => parseBackupKey("change-me"), FailClosedError);
  assert.throws(() => parseBackupKey("abcd"), FailClosedError);
  const key = parseBackupKey(testKey());
  assert.throws(() => decryptDump(fixture, key), FailClosedError);
  const encPath = join(outDir, "foreign.dump.enc");
  writeFileSync(encPath, fixture);
  writeFileSync(
    `${encPath}.meta.json`,
    `${JSON.stringify({
      schema_version: "control-center.backup.v1",
      source: "x",
      observed_at: "2026-08-20T06:00:00Z",
      freshness_status: "fresh",
      confidence: 1,
      algorithm: "aes-256-gcm",
      sha256_plaintext: "00".repeat(32),
      bytes_plaintext: fixture.length,
      bytes_ciphertext: fixture.length,
      filename: "foreign.dump.enc",
    })}\n`,
  );
  assert.throws(() => verifyEncryptedBackup(encPath, key), FailClosedError);
});
