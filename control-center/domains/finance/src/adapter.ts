import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FinanceValidationError } from "./errors.js";
import { createMemoryLedger, type MemoryFinanceLedger } from "./adjustments.js";
import { parseFixtureDocument } from "./validate.js";
import type { FinanceEvent, FixtureDocument } from "./types.js";

export function financePackageRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function fixtureFilePath(name: string): string {
  const file = name.endsWith(".json") ? name : `${name}.json`;
  return join(financePackageRoot(), "fixtures", file);
}

export function resolveFixturePath(nameOrPath: string): string {
  if (existsSync(nameOrPath)) {
    return nameOrPath;
  }
  const candidates = [
    join(financePackageRoot(), nameOrPath),
    nameOrPath.startsWith("fixtures/")
      ? join(financePackageRoot(), nameOrPath)
      : fixtureFilePath(nameOrPath),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new FinanceValidationError(
    "FINANCE_FIXTURE_NOT_FOUND",
    `fixture not found: ${nameOrPath}`,
  );
}

export function loadFixtureDocument(nameOrPath: string): FixtureDocument {
  const raw = readFileSync(resolveFixturePath(nameOrPath), "utf8");
  const parsed: unknown = JSON.parse(raw);
  return parseFixtureDocument(parsed);
}

export function eventsFromDocument(doc: FixtureDocument): FinanceEvent[] {
  return [...doc.events];
}

export function createFixturePort(doc: FixtureDocument): MemoryFinanceLedger {
  return createMemoryLedger(doc.events);
}

export function loadFixturePort(nameOrPath: string): {
  document: FixtureDocument;
  port: MemoryFinanceLedger;
} {
  const document = loadFixtureDocument(nameOrPath);
  return { document, port: createFixturePort(document) };
}
