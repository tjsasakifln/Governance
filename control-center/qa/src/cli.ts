#!/usr/bin/env node
/**
 * Hostile QA gate entry. Local files only. Never calls Asaas, Warmbly, GitHub,
 * or any provider mutation (cobrança, checkout, refund, cancelamento, send).
 */
import {
  runAdversarialCorpus,
  runControlCorpus,
  runExplicitChecksCorpus,
} from "./corpus.js";
import type { GateReport } from "./types.js";

export type CorpusArg =
  | "adversarial"
  | "controls"
  | "all-pass"
  | "unknown-check"
  | "missing-check";

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
    value === "missing-check"
  ) {
    return value;
  }
  throw new Error(
    "unknown --corpus; use adversarial | controls | all-pass | unknown-check | missing-check",
  );
}

export function runGate(corpus: CorpusArg): GateReport {
  switch (corpus) {
    case "adversarial":
      return runAdversarialCorpus();
    case "controls":
      return runControlCorpus();
    case "all-pass":
    case "unknown-check":
    case "missing-check":
      return runExplicitChecksCorpus(corpus);
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
        "Usage: tsx src/cli.ts [--corpus adversarial|controls|all-pass|unknown-check|missing-check]",
        "",
        "Default corpus is adversarial (hostile). READY_FOR_INTERNAL_PRODUCTION is",
        "granted only when every named attack check is explicitly pass.",
        "No provider APIs are called.",
        "",
      ].join("\n"),
    );
    process.exitCode = 0;
    return;
  }
  const corpus = parseCorpus(argv);
  const report = runGate(corpus);
  process.stdout.write(formatReport(report));
  process.exitCode = exitCodeFor(report);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("cli.ts") || entry.endsWith("cli.js") || entry.includes("cc-qa-gate")) {
  main(process.argv.slice(2));
}
