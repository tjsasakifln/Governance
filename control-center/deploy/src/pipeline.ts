import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseBackupKey,
  restoreEncryptedBackup,
  verifyEncryptedBackup,
  writeEncryptedBackup,
  type BackupMeta,
} from "./backup.ts";
import { assertDiskSpace, parseMinBytes, type DiskStatFn } from "./disk-guard.ts";
import { failClosed } from "./fail-closed.ts";
import { parseRetainDays, parseRetainMin, pruneBackupDir } from "./retention.ts";

export interface BackupPipelineResult {
  encPath: string;
  metaPath: string;
  meta: BackupMeta;
  restoredEqualsPlaintext: true;
  ciphertextDiffers: true;
  kept: string[];
  dropped: string[];
}

export function runBackupPipeline(opts: {
  plaintext: Buffer;
  keyRaw: string | undefined;
  outDir: string;
  observedAt: string;
  diskPath?: string;
  minBytesRaw?: string;
  retainDaysRaw?: string;
  retainMinRaw?: string;
  now?: Date;
  statFn?: DiskStatFn;
  source?: string;
}): BackupPipelineResult {
  const key = parseBackupKey(opts.keyRaw);
  mkdirSync(opts.outDir, { recursive: true });
  assertDiskSpace({
    path: opts.diskPath ?? opts.outDir,
    minBytes: parseMinBytes(opts.minBytesRaw),
    ...(opts.statFn ? { statFn: opts.statFn } : {}),
  });
  const written = writeEncryptedBackup({
    plaintext: opts.plaintext,
    key,
    outDir: opts.outDir,
    observedAt: opts.observedAt,
    ...(opts.source ? { source: opts.source } : {}),
  });
  const verified = verifyEncryptedBackup(written.encPath, key);
  if (!verified.equals(opts.plaintext)) {
    failClosed("verified backup does not match source dump");
  }
  if (written.ciphertext.equals(opts.plaintext)) {
    failClosed("ciphertext equals plaintext");
  }
  const pruned = pruneBackupDir(
    opts.outDir,
    opts.now ?? new Date(opts.observedAt),
    parseRetainDays(opts.retainDaysRaw),
    parseRetainMin(opts.retainMinRaw),
  );
  return {
    encPath: written.encPath,
    metaPath: written.metaPath,
    meta: written.meta,
    restoredEqualsPlaintext: true,
    ciphertextDiffers: true,
    kept: pruned.kept,
    dropped: pruned.dropped,
  };
}

export function runRestorePipeline(opts: {
  encPath: string;
  keyRaw: string | undefined;
  outFile: string;
  diskPath: string;
  minBytesRaw?: string;
  statFn?: DiskStatFn;
}): Buffer {
  parseBackupKey(opts.keyRaw);
  assertDiskSpace({
    path: opts.diskPath,
    minBytes: parseMinBytes(opts.minBytesRaw),
    ...(opts.statFn ? { statFn: opts.statFn } : {}),
  });
  return restoreEncryptedBackup(opts.encPath, parseBackupKey(opts.keyRaw), opts.outFile);
}

export function backupFixtureDump(fixturePath: string, opts: {
  keyRaw: string | undefined;
  outDir: string;
  observedAt: string;
  diskPath?: string;
  minBytesRaw?: string;
  retainDaysRaw?: string;
  retainMinRaw?: string;
  now?: Date;
  statFn?: DiskStatFn;
}): BackupPipelineResult {
  const plaintext = readFileSync(fixturePath);
  return runBackupPipeline({
    plaintext,
    keyRaw: opts.keyRaw,
    outDir: opts.outDir,
    observedAt: opts.observedAt,
    source: "control-center.deploy.fixture",
    ...(opts.diskPath ? { diskPath: opts.diskPath } : {}),
    ...(opts.minBytesRaw ? { minBytesRaw: opts.minBytesRaw } : {}),
    ...(opts.retainDaysRaw ? { retainDaysRaw: opts.retainDaysRaw } : {}),
    ...(opts.retainMinRaw ? { retainMinRaw: opts.retainMinRaw } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.statFn ? { statFn: opts.statFn } : {}),
  });
}

export function restoreTo(outDir: string, encPath: string, keyRaw: string | undefined, name: string): Buffer {
  const outFile = join(outDir, name);
  return runRestorePipeline({
    encPath,
    keyRaw,
    outFile,
    diskPath: outDir,
  });
}
