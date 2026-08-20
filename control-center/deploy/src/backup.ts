import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { failClosed } from "./fail-closed.ts";

export const BACKUP_MAGIC = Buffer.from("CCBK01");
export const BACKUP_ALGORITHM = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

export interface BackupMeta {
  schema_version: "control-center.backup.v1";
  source: string;
  observed_at: string;
  freshness_status: "fresh" | "stale" | "unknown" | "expired";
  confidence: number;
  algorithm: typeof BACKUP_ALGORITHM;
  sha256_plaintext: string;
  bytes_plaintext: number;
  bytes_ciphertext: number;
  filename: string;
}

export function parseBackupKey(raw: string | undefined): Buffer {
  if (raw === undefined || raw.trim() === "") {
    failClosed("CONTROL_CENTER_BACKUP_KEY is missing");
  }
  const key = raw.trim();
  if (/change-?me|placeholder|example|insert|todo|xxx|your-?key/i.test(key)) {
    failClosed("CONTROL_CENTER_BACKUP_KEY looks like a placeholder");
  }
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    failClosed("CONTROL_CENTER_BACKUP_KEY must be 64 hex characters");
  }
  return Buffer.from(key, "hex");
}

export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function encryptDump(plaintext: Buffer, key: Buffer): Buffer {
  if (plaintext.length === 0) {
    failClosed("refusing to encrypt empty dump");
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(BACKUP_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([BACKUP_MAGIC, iv, tag, ciphertext]);
}

export function decryptDump(blob: Buffer, key: Buffer): Buffer {
  const min = BACKUP_MAGIC.length + IV_LEN + TAG_LEN + 1;
  if (blob.length < min) {
    failClosed("ciphertext too short");
  }
  if (!blob.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    failClosed("missing CCBK01 magic; refusing unencrypted or foreign blob");
  }
  const ivStart = BACKUP_MAGIC.length;
  const tagStart = ivStart + IV_LEN;
  const dataStart = tagStart + TAG_LEN;
  const iv = blob.subarray(ivStart, tagStart);
  const tag = blob.subarray(tagStart, dataStart);
  const ciphertext = blob.subarray(dataStart);
  const decipher = createDecipheriv(BACKUP_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    failClosed("backup authentication failed");
  }
}

function assertUtcIso(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) {
    failClosed("observed_at must be UTC ISO-8601 ending with Z");
  }
}

export function writeEncryptedBackup(opts: {
  plaintext: Buffer;
  key: Buffer;
  outDir: string;
  observedAt: string;
  source?: string;
}): { encPath: string; metaPath: string; meta: BackupMeta; ciphertext: Buffer } {
  assertUtcIso(opts.observedAt);
  mkdirSync(opts.outDir, { recursive: true });
  const ciphertext = encryptDump(opts.plaintext, opts.key);
  if (ciphertext.equals(opts.plaintext)) {
    failClosed("encryption produced ciphertext identical to plaintext");
  }
  const stamp = opts.observedAt.replace(/[:.]/g, "-");
  const filename = `cc-pg-${stamp}.dump.enc`;
  const encPath = join(opts.outDir, filename);
  const meta: BackupMeta = {
    schema_version: "control-center.backup.v1",
    source: opts.source ?? "postgres.control_center",
    observed_at: opts.observedAt,
    freshness_status: "fresh",
    confidence: 1,
    algorithm: BACKUP_ALGORITHM,
    sha256_plaintext: sha256Hex(opts.plaintext),
    bytes_plaintext: opts.plaintext.length,
    bytes_ciphertext: ciphertext.length,
    filename,
  };
  writeFileSync(encPath, ciphertext);
  const metaPath = `${encPath}.meta.json`;
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  return { encPath, metaPath, meta, ciphertext };
}

export function parseBackupMeta(raw: string): BackupMeta {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    failClosed("backup meta is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    failClosed("backup meta is not an object");
  }
  const rec = parsed as Record<string, unknown>;
  if (rec.schema_version !== "control-center.backup.v1") {
    failClosed("backup meta schema_version mismatch");
  }
  if (typeof rec.source !== "string" || rec.source.length === 0) {
    failClosed("backup meta source missing");
  }
  if (typeof rec.observed_at !== "string") {
    failClosed("backup meta observed_at missing");
  }
  assertUtcIso(rec.observed_at);
  if (typeof rec.sha256_plaintext !== "string" || rec.sha256_plaintext.length !== 64) {
    failClosed("backup meta sha256_plaintext missing");
  }
  if (rec.algorithm !== BACKUP_ALGORITHM) {
    failClosed("backup meta algorithm mismatch");
  }
  if (typeof rec.filename !== "string") {
    failClosed("backup meta filename missing");
  }
  const freshness = rec.freshness_status;
  if (
    freshness !== "fresh" &&
    freshness !== "stale" &&
    freshness !== "unknown" &&
    freshness !== "expired"
  ) {
    failClosed("backup meta freshness_status invalid");
  }
  const confidence = rec.confidence;
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) {
    failClosed("backup meta confidence invalid");
  }
  const bytesPlain = rec.bytes_plaintext;
  const bytesCipher = rec.bytes_ciphertext;
  if (typeof bytesPlain !== "number" || typeof bytesCipher !== "number") {
    failClosed("backup meta byte counts missing");
  }
  return {
    schema_version: "control-center.backup.v1",
    source: rec.source,
    observed_at: rec.observed_at,
    freshness_status: freshness,
    confidence,
    algorithm: BACKUP_ALGORITHM,
    sha256_plaintext: rec.sha256_plaintext,
    bytes_plaintext: bytesPlain,
    bytes_ciphertext: bytesCipher,
    filename: rec.filename,
  };
}

export function verifyEncryptedBackup(encPath: string, key: Buffer): Buffer {
  const blob = readFileSync(encPath);
  const meta = parseBackupMeta(readFileSync(`${encPath}.meta.json`, "utf8"));
  const plain = decryptDump(blob, key);
  if (sha256Hex(plain) !== meta.sha256_plaintext) {
    failClosed("backup verification hash mismatch");
  }
  if (blob.equals(plain)) {
    failClosed("ciphertext equals plaintext");
  }
  return plain;
}

export function restoreEncryptedBackup(
  encPath: string,
  key: Buffer,
  outFile: string,
): Buffer {
  const plain = verifyEncryptedBackup(encPath, key);
  writeFileSync(outFile, plain);
  return plain;
}
