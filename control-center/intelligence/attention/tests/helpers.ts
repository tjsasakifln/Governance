import type { AttentionSignal, FounderOverride, ScoringConfigPatch } from "../src/types.js";
import { mergeScoringConfig } from "../src/default-config.js";
import type { SignalCategory, SignalDomain, FreshnessStatus, AttentionSeverity, AttentionStatus } from "../src/taxonomy.js";

export const FROZEN_NOW = "2026-08-20T15:00:00.000Z";

export interface SignalOverrides {
  id: string;
  title?: string;
  summary?: string;
  category: SignalCategory;
  domain: SignalDomain;
  scope?: string;
  impact: number;
  urgency: number;
  severity?: AttentionSeverity;
  status?: AttentionStatus;
  correlation_key?: string;
  freshness_status?: FreshnessStatus;
  confidence?: number;
  observed_at?: string;
  source_system?: string;
  source_kind?: string;
  locator?: string;
  recommended_action?: string;
}

export function makeSignal(over: SignalOverrides): AttentionSignal {
  const signal: AttentionSignal = {
    id: over.id,
    title: over.title ?? over.id,
    summary: over.summary ?? over.title ?? over.id,
    category: over.category,
    domain: over.domain,
    scope: over.scope ?? "company",
    impact: over.impact,
    urgency: over.urgency,
    severity: over.severity ?? "medium",
    status: over.status ?? "open",
    correlation_key: over.correlation_key ?? over.id,
    evidence_refs: [
      {
        source: {
          system: over.source_system ?? "manual",
          kind: over.source_kind ?? "note",
          locator: over.locator ?? over.id,
        },
      },
    ],
    provenance: {
      source: {
        system: over.source_system ?? "manual",
        kind: over.source_kind ?? "note",
        locator: over.locator ?? over.id,
      },
      observed_at: over.observed_at ?? "2026-08-20T14:00:00.000Z",
      freshness_status: over.freshness_status ?? "FRESH",
      confidence: over.confidence ?? 1,
    },
  };
  if (over.recommended_action !== undefined) {
    signal.recommended_action = over.recommended_action;
  }
  return signal;
}

export function request(opts: {
  signals: AttentionSignal[];
  config?: ScoringConfigPatch;
  override?: FounderOverride | null;
  now?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    now: opts.now ?? FROZEN_NOW,
    signals: opts.signals,
  };
  if (opts.config !== undefined) {
    body.config = opts.config;
  }
  if (opts.override !== undefined && opts.override !== null) {
    body.override = opts.override;
  }
  return body;
}

export function idsOf(items: { id: string }[]): string[] {
  return items.map((i) => i.id);
}

export { mergeScoringConfig };
