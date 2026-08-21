import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WarmblyPayload } from "../src/contracts/warmbly-payload.ts";

export const NOW = new Date("2026-08-20T15:00:00.000Z");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadFixture(name: string): WarmblyPayload {
  const text = readFileSync(join(ROOT, "fixtures", name), "utf8");
  return JSON.parse(text) as WarmblyPayload;
}

export function capturingLogger(): {
  entries: Array<Record<string, unknown>>;
  logger: (entry: { level: "info" | "warn" | "error"; msg: string; [k: string]: unknown }) => void;
  blob: () => string;
} {
  const entries: Array<Record<string, unknown>> = [];
  return {
    entries,
    logger: (entry) => {
      entries.push(entry);
    },
    blob: () => JSON.stringify(entries),
  };
}
