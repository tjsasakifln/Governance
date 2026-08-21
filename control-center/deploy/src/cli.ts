import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createLogger } from "./log.ts";
import { parseBackupKey, restoreEncryptedBackup, verifyEncryptedBackup } from "./backup.ts";
import { assertDiskSpace, parseMinBytes } from "./disk-guard.ts";
import { FailClosedError } from "./fail-closed.ts";
import { FIXTURE_DUMP } from "./paths.ts";
import { runBackupPipeline } from "./pipeline.ts";
import { parseRetainDays, parseRetainMin, pruneBackupDir } from "./retention.ts";
import { runRestoreDrill } from "./restore-drill.ts";
import { formatValidateReport, validatePack } from "./validate.ts";

const logger = createLogger("control-center-deploy");

function flag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) {
    return undefined;
  }
  const value = process.argv[idx + 1];
  if (value === undefined || value.startsWith("--")) {
    return undefined;
  }
  return value;
}

function requiredFlag(name: string): string {
  const value = flag(name);
  if (value === undefined || value.trim() === "") {
    throw new FailClosedError(`missing --${name}`);
  }
  return value;
}

function usage(): string {
  return [
    "cc-deploy <validate|backup|restore|verify|retain|disk-guard|restore-drill>",
    "  validate",
    "  backup --in <dump> --out <dir>",
    "  restore --in <enc> --out <file>",
    "  verify --in <enc>",
    "  retain --dir <dir>",
    "  disk-guard --path <dir>",
    "  restore-drill --out <dir>",
  ].join("\n");
}

function main(): void {
  const cmd = process.argv[2];
  if (cmd === undefined || cmd === "--help" || cmd === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (cmd === "validate") {
    const report = validatePack(process.env);
    process.stdout.write(formatValidateReport(report));
    logger.info("validate.ok", {
      project: report.project,
      postgres_volume: report.postgres_volume,
      caddy_hook: report.caddy_hook,
      backup: report.backup,
      restore: report.restore,
      retention: report.retention,
      disk_guard: report.disk_guard,
    });
    return;
  }
  if (cmd === "backup") {
    const input = requiredFlag("in");
    const outDir = requiredFlag("out");
    mkdirSync(outDir, { recursive: true });
    const result = runBackupPipeline({
      plaintext: readFileSync(input),
      keyRaw: process.env.CONTROL_CENTER_BACKUP_KEY,
      outDir,
      observedAt: flag("observed-at") ?? new Date().toISOString(),
      diskPath: process.env.CONTROL_CENTER_DISK_PATH ?? outDir,
      ...(process.env.CONTROL_CENTER_DISK_MIN_BYTES
        ? { minBytesRaw: process.env.CONTROL_CENTER_DISK_MIN_BYTES }
        : {}),
      ...(process.env.CONTROL_CENTER_BACKUP_RETAIN_DAYS
        ? { retainDaysRaw: process.env.CONTROL_CENTER_BACKUP_RETAIN_DAYS }
        : {}),
      ...(process.env.CONTROL_CENTER_BACKUP_RETAIN_MIN
        ? { retainMinRaw: process.env.CONTROL_CENTER_BACKUP_RETAIN_MIN }
        : {}),
    });
    logger.info("backup.ok", {
      filename: result.meta.filename,
      bytes_plaintext: result.meta.bytes_plaintext,
      bytes_ciphertext: result.meta.bytes_ciphertext,
      source: result.meta.source,
      observed_at: result.meta.observed_at,
      freshness_status: result.meta.freshness_status,
    });
    process.stdout.write(`${result.encPath}\n`);
    return;
  }
  if (cmd === "restore") {
    const encPath = requiredFlag("in");
    const outFile = requiredFlag("out");
    const outDir = dirname(outFile);
    mkdirSync(outDir === "" ? "." : outDir, { recursive: true });
    const diskPath = process.env.CONTROL_CENTER_DISK_PATH ?? (outDir === "" ? "." : outDir);
    assertDiskSpace({
      path: diskPath,
      minBytes: parseMinBytes(process.env.CONTROL_CENTER_DISK_MIN_BYTES),
    });
    restoreEncryptedBackup(encPath, parseBackupKey(process.env.CONTROL_CENTER_BACKUP_KEY), outFile);
    logger.info("restore.ok", { out: outFile });
    return;
  }
  if (cmd === "verify") {
    const encPath = requiredFlag("in");
    const plain = verifyEncryptedBackup(
      encPath,
      parseBackupKey(process.env.CONTROL_CENTER_BACKUP_KEY),
    );
    logger.info("verify.ok", { bytes: plain.length });
    return;
  }
  if (cmd === "retain") {
    const dir = requiredFlag("dir");
    const nowRaw = flag("now");
    const now = nowRaw ? new Date(nowRaw) : new Date();
    const result = pruneBackupDir(
      dir,
      now,
      parseRetainDays(process.env.CONTROL_CENTER_BACKUP_RETAIN_DAYS),
      parseRetainMin(process.env.CONTROL_CENTER_BACKUP_RETAIN_MIN),
    );
    logger.info("retain.ok", { kept: result.kept.length, dropped: result.dropped.length });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (cmd === "disk-guard") {
    const path = requiredFlag("path");
    const result = assertDiskSpace({
      path,
      minBytes: parseMinBytes(process.env.CONTROL_CENTER_DISK_MIN_BYTES ?? flag("min-bytes")),
    });
    logger.info("disk_guard.ok", {
      path: result.path,
      free_bytes: result.freeBytes,
      min_bytes: result.minBytes,
    });
    return;
  }
  if (cmd === "restore-drill") {
    const outDir = requiredFlag("out");
    const result = runRestoreDrill({
      fixturePath: flag("fixture") ?? FIXTURE_DUMP,
      outDir,
      keyRaw: process.env.CONTROL_CENTER_BACKUP_KEY,
    });
    writeFileSync(
      `${outDir}/drill-summary.json`,
      `${JSON.stringify(
        {
          fixturePath: result.fixturePath,
          fixtureBytes: result.fixtureBytes,
          sameContent: result.sameContent,
          run1: result.run1.restoredPath,
          run2: result.run2.restoredPath,
        },
        null,
        2,
      )}\n`,
    );
    logger.info("restore_drill.ok", {
      fixture_bytes: result.fixtureBytes,
      same_content: true,
    });
    process.stdout.write(
      `restore-drill ok fixture_bytes=${result.fixtureBytes} same_content=true\n`,
    );
    return;
  }
  throw new FailClosedError(`unknown command ${cmd}\n${usage()}`);
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : "internal error";
  logger.error("cli.fail_closed", { err: message });
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
