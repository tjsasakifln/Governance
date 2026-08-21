#!/usr/bin/env node
/**
 * Hostile QA gate entry. Local files only. Never calls Asaas, Warmbly, GitHub,
 * or any provider mutation (cobrança, checkout, refund, cancelamento, send).
 */
import { readFileSync } from "node:fs";
import {
  runAdversarialCorpus,
  runControlCorpus,
  runExplicitChecksCorpus,
} from "./corpus.js";
import { runLiveGate } from "./live-gate.js";
import type { LiveSnapshot } from "./live-port.js";
import type { GateReport } from "./types.js";

export type CorpusArg =
  | "adversarial"
  | "controls"
  | "all-pass"
  | "unknown-check"
  | "missing-check"
  | "live";

export function parseCorpus(argv: string[]): CorpusArg {
  const idx = argv.indexOf("--corpus");
  if (idx === -1) {
    return "adversarial";
  }
  const value = argv[idx + 1];
  if (
    value === "adversarial" ||
    value === "controls" ||
    value === "all-pass" ||
    value === "unknown-check" ||
    value === "missing-check" ||
    value === "live"
  ) {
    return value;
  }
  throw new Error(
    "unknown --corpus; use adversarial | controls | all-pass | unknown-check | missing-check | live",
  );
}

export function snapshotPathFromArgv(argv: string[]): string | undefined {
  const idx = argv.indexOf("--snapshot");
  if (idx === -1) {
    return process.env.CC_QA_LIVE_SNAPSHOT;
  }
  const value = argv[idx + 1];
  if (!value || value.startsWith("--")) {
    return process.env.CC_QA_LIVE_SNAPSHOT;
  }
  return value;
}

export function loadLiveSnapshotFile(absPath: string): LiveSnapshot {
  const parsed = JSON.parse(readFileSync(absPath, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`live snapshot is not an object: ${absPath}`);
  }
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.as_of !== "string" || rec.as_of.length === 0) {
    throw new Error("live snapshot missing as_of");
  }
  return rec as unknown as LiveSnapshot;
}

export function runGate(corpus: CorpusArg, argv: string[] = []): GateReport {
  switch (corpus) {
    case "adversarial":
      return runAdversarialCorpus();
    case "controls":
      return runControlCorpus();
    case "all-pass":
    case "unknown-check":
    case "missing-check":
      return runExplicitChecksCorpus(corpus);
    case "live": {
      const path = snapshotPathFromArgv(argv);
      if (!path) {
        throw new Error("live corpus requires --snapshot <file> or CC_QA_LIVE_SNAPSHOT");
      }
      return runLiveGate(loadLiveSnapshotFile(path));
    }
    default: {
      const _never: never = corpus;
      throw new Error(`unhandled corpus ${_never}`);
    }
  }
}

export function formatReport(report: GateReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function exitCodeFor(report: GateReport): number {
  return report.READY_FOR_INTERNAL_PRODUCTION ? 0 : 2;
}

function main(argv: string[]): void {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        "cc-qa-gate — Control Center adversarial QA gate",
        "",
        "Usage: tsx src/cli.ts [--corpus adversarial|controls|all-pass|unknown-check|missing-check|live]",
        "       tsx src/cli.ts --corpus live --snapshot <live-snapshot.json>",
        "",
        "Default corpus is adversarial (hostile). READY_FOR_INTERNAL_PRODUCTION is",
        "granted only when every named attack check is explicitly pass.",
        "The live corpus evaluates a snapshot collected from Postgres/MCP/HTTP.",
        "No provider mutations are performed.",
        "",
      ].join("\n"),
    );
    process.exitCode = 0;
    return;
  }
  const corpus = parseCorpus(argv);
  const report = runGate(corpus, argv);
  process.stdout.write(formatReport(report));
  process.exitCode = exitCodeFor(report);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("cli.ts") || entry.endsWith("cli.js") || entry.includes("cc-qa-gate")) {
  main(process.argv.slice(2));
}
