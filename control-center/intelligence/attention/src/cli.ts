#!/usr/bin/env node
/**
 * One-shot consumer of the published export `rankFromUnknown`.
 * Reads a JSON request (signals + optional config/override/now) and writes
 * the ranking JSON to stdout. Logs go to stderr only.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rankFromUnknown } from "./rank.js";
import { createLogger, silentLogger } from "./log.js";
import { ValidationError, ConfigError } from "./errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const defaultFixture = join(here, "..", "fixtures", "representative.json");

function main(argv: string[]): number {
  const verbose = process.env.CC_ATTENTION_LOG === "1";
  const log = verbose ? createLogger() : silentLogger;
  const inputPath = argv[2] ?? defaultFixture;
  log.info("rank.start", { input: inputPath });
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(inputPath, "utf8")) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : "read_failed";
    log.error("rank.read_failed", { input: inputPath, err: message });
    process.stderr.write(`failed to read ${inputPath}: ${message}\n`);
    return 1;
  }
  try {
    const output = rankFromUnknown(raw);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    log.info("rank.done", {
      now_count: output.attention_now.length,
      today_count: output.today.length,
      audit_count: output.audit.length,
      fingerprint: output.config_fingerprint,
    });
    return 0;
  } catch (err) {
    if (err instanceof ValidationError || err instanceof ConfigError) {
      log.error("rank.rejected", { code: err.code, err: err.message });
      process.stderr.write(`${err.code}: ${err.message}\n`);
      return 2;
    }
    const message = err instanceof Error ? err.message : "rank_failed";
    log.error("rank.failed", { err: message });
    process.stderr.write(`rank failed: ${message}\n`);
    return 1;
  }
}

const exitCode = main(process.argv);
if (exitCode !== 0) {
  process.exitCode = exitCode;
}
