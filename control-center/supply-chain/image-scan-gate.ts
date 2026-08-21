#!/usr/bin/env node
/**
 * CI gate over Trivy JSON, npm audit, and the exception file.
 * Does not delete the scanner. Does not bulk-mark false positives.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateExceptions,
  evaluateNpmAudit,
  evaluateTrivyReport,
  parseExceptionFile,
  type CveExceptionFile,
  type GateFailure,
  type TrivyReport,
} from "./cve-policy.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function arg(name: string, fallback?: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing --${name}`);
  }
  const value = process.argv[idx + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for --${name}`);
  }
  return value;
}

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function collectReports(dir: string): Array<{ path: string; report: TrivyReport }> {
  if (!existsSync(dir)) {
    return [];
  }
  const out: Array<{ path: string; report: TrivyReport }> = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || name.includes("sbom") || name.includes("spdx") || name.includes("cdx")) {
      continue;
    }
    if (name.includes("license") || name.includes("audit")) {
      continue;
    }
    const path = join(dir, name);
    try {
      const parsed = loadJson(path);
      if (parsed && typeof parsed === "object" && ("Results" in parsed || "ArtifactName" in parsed)) {
        out.push({ path, report: parsed as TrivyReport });
      }
    } catch {
      // ignore non-trivy json
    }
  }
  return out;
}

export function runGate(opts: {
  exceptionsPath: string;
  trivyDir?: string;
  npmAuditPath?: string;
  now?: Date;
}): { ok: boolean; failures: GateFailure[] } {
  const file = parseExceptionFile(loadJson(opts.exceptionsPath)) as CveExceptionFile;
  const failures: GateFailure[] = [...evaluateExceptions(file, { now: opts.now }).failures];
  if (opts.trivyDir) {
    for (const { path, report } of collectReports(opts.trivyDir)) {
      const image = report.ArtifactName ?? path;
      failures.push(...evaluateTrivyReport(report, file.exceptions, { now: opts.now, image }).failures);
    }
  }
  if (opts.npmAuditPath && existsSync(opts.npmAuditPath)) {
    failures.push(...evaluateNpmAudit(loadJson(opts.npmAuditPath) as { vulnerabilities?: Record<string, { severity?: string; via?: unknown }> }).failures);
  }
  const unique = new Map<string, GateFailure>();
  for (const f of failures) {
    unique.set(`${f.code}:${f.message}`, f);
  }
  return { ok: unique.size === 0, failures: [...unique.values()] };
}

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === join(process.argv[1]);

if (isMain || process.argv[1]?.endsWith("image-scan-gate.ts") || process.argv[1]?.endsWith("image-scan-gate.js")) {
  const exceptionsPath = arg("exceptions", join(root, "supply-chain/cve-exceptions.json"));
  const trivyDir = process.argv.includes("--trivy-dir") ? arg("trivy-dir") : undefined;
  const npmAuditPath = process.argv.includes("--npm-audit") ? arg("npm-audit") : undefined;
  const result = runGate({ exceptionsPath, trivyDir, npmAuditPath });
  process.stdout.write(`${JSON.stringify({ ok: result.ok, failures: result.failures }, null, 2)}\n`);
  if (!result.ok) {
    process.exitCode = 1;
  }
}
