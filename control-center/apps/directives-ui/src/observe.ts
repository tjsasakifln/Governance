import { authorityClass } from "./contract.ts";
import type { Directive, ObservedDirective } from "./types.ts";

export const MOCK_SOURCE_SYSTEM = "governance";

export function observeDirective(record: Directive, observedAt: string): ObservedDirective {
  const authority = authorityClass(record.kind);
  const confidence = authority === "hypothesis" ? 0.4 : authority === "orientative" ? 0.8 : 1;
  return {
    record,
    source: MOCK_SOURCE_SYSTEM,
    observed_at: observedAt,
    freshness_status: "FRESH",
    confidence,
  };
}

export function observeAll(records: readonly Directive[], observedAt: string): ObservedDirective[] {
  return records.map((record) => observeDirective(record, observedAt));
}
