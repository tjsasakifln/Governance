import assert from "node:assert/strict";
import { test } from "node:test";
import { rankAttention } from "../src/rank.js";
import { mergeScoringConfig } from "../src/default-config.js";
import {
  REASON_MAX_LENGTH,
  SCORE_SENTENCE_RE,
  buildReason,
  buildReasonParts,
  joinReasonParts,
  splitReason,
} from "../src/explain.js";
import { FROZEN_NOW, makeSignal } from "./helpers.js";
import type { AttentionSignal } from "../src/types.js";

/** Tokens a cockpit must never show on the front of a card. */
const INTERNAL_TOKENS = [
  "peso_categoria",
  "freshness_bp",
  "confidence_bp",
  "eixo ",
  "score_milli",
];

function bag(): AttentionSignal[] {
  return [
    makeSignal({
      id: "cc:attention-item:incident",
      title: "Incidente de engenharia aberto",
      category: "blocker",
      domain: "engineering",
      impact: 92,
      urgency: 85,
      severity: "critical",
      source_system: "github",
      source_kind: "repo-read",
      locator: "engineering/company",
    }),
    makeSignal({
      id: "cc:attention-item:overdue",
      title: "Recebível vencido",
      category: "receita",
      domain: "finance",
      scope: "finance",
      impact: 88,
      urgency: 65,
      severity: "high",
      confidence: 0.9,
      source_system: "asaas",
      source_kind: "receivable-read",
      locator: "finance/receivables",
    }),
    makeSignal({
      id: "cc:attention-item:stale-feed",
      title: "Coleta defasada",
      category: "risco_operacional",
      domain: "infrastructure",
      scope: "infrastructure",
      impact: 40,
      urgency: 30,
      severity: "medium",
      freshness_status: "STALE",
      confidence: 0.4,
      source_system: "collector",
      source_kind: "host-health",
      locator: "infrastructure/hosts",
    }),
    makeSignal({
      id: "cc:attention-item:cosmetic",
      title: "Ajuste estético de copy",
      category: "estetica",
      domain: "company",
      impact: 10,
      urgency: 99,
      severity: "low",
    }),
  ];
}

function ranked() {
  const output = rankAttention({
    signals: bag(),
    config: mergeScoringConfig(undefined),
    clock_now: FROZEN_NOW,
    override: null,
  });
  return [...output.attention_now, ...output.today];
}

test("splitReason quarantines the arithmetic: the plain half never leaks an internal weight", () => {
  const items = ranked();
  assert.ok(items.length > 0);
  for (const item of items) {
    const { plain, technical } = splitReason(item.reason);
    assert.match(technical, SCORE_SENTENCE_RE, `no formula found in ${item.id}: ${item.reason}`);
    for (const token of INTERNAL_TOKENS) {
      assert.equal(
        plain.includes(token),
        false,
        `plain half of ${item.id} leaked ${token}: ${plain}`,
      );
    }
  }
});

test("splitReason is lossless: plain + technical rebuild the wire string", () => {
  for (const item of ranked()) {
    const { plain, technical } = splitReason(item.reason);
    const rebuilt = plain.length > 0 ? `${plain} ${technical}` : technical;
    assert.equal(rebuilt, item.reason, item.id);
  }
});

test("the technical half carries the formula and the evidence locators together", () => {
  const items = ranked();
  const withEvidence = items.filter((item) => item.evidence_refs.length > 0);
  assert.ok(withEvidence.length > 0);
  for (const item of withEvidence) {
    const { technical } = splitReason(item.reason);
    assert.ok(technical.includes("Evidências:"), `${item.id}: ${technical}`);
    const first = item.evidence_refs[0]!.source;
    assert.ok(
      technical.includes(`${first.system}:${first.kind}:${first.locator}`),
      `${item.id}: ${technical}`,
    );
  }
});

test("a rationale with no formula stays entirely plain", () => {
  const result = splitReason("A fila de inbound tem itens com mais de quatro horas.");
  assert.equal(result.technical, "");
  assert.equal(result.plain, "A fila de inbound tem itens com mais de quatro horas.");
});

test("buildReason is exactly joinReasonParts(buildReasonParts(...)) and stays under the wire cap", () => {
  const output = rankAttention({
    signals: bag(),
    config: mergeScoringConfig(undefined),
    clock_now: FROZEN_NOW,
    override: null,
  });
  for (const horizon of ["now", "today"] as const) {
    const items = horizon === "now" ? output.attention_now : output.today;
    for (const item of items) {
      assert.ok(item.reason.length <= REASON_MAX_LENGTH);
      assert.match(item.reason, SCORE_SENTENCE_RE);
    }
  }
  // The composed string and the decomposed parts cannot drift: one producer.
  const candidate = {
    id: "cc:attention-item:probe",
    title: "probe",
    summary: "probe",
    category: "blocker" as const,
    domain: "engineering" as const,
    scope: "company",
    impact: 90,
    urgency: 80,
    severity: "critical" as const,
    status: "open" as const,
    item_kind: "work" as const,
    correlation_key: "probe",
    evidence_refs: [{ source: { system: "github", kind: "repo-read", locator: "probe" } }],
    provenance: {
      source: { system: "github", kind: "repo-read", locator: "probe" },
      observed_at: "2026-08-20T14:00:00.000Z",
      freshness_status: "FRESH" as const,
      confidence: 1,
    },
    related_ids: [],
    source_ids: ["cc:attention-item:probe"],
    merge_count: 1,
    forced_by_kill_rule: true,
    score_milli: 1_000,
    breakdown: {
      category: "blocker" as const,
      category_weight: 95,
      category_tier: 2,
      impact: 90,
      urgency: 80,
      impact_weight: 0.7,
      urgency_weight: 0.3,
      impact_weight_bp: 7_000,
      urgency_weight_bp: 3_000,
      axis: 870_000,
      raw: 8_265,
      freshness_status: "FRESH" as const,
      freshness_multiplier: 1,
      freshness_bp: 10_000,
      confidence: 1,
      confidence_bp: 10_000,
      score_milli: 1_000,
      score: 1,
      kill_rule_applied: true,
      merge_count: 1,
      freshness_demoted: false,
      source_freshness_status: "FRESH" as const,
    },
  };
  assert.equal(
    joinReasonParts(buildReasonParts(candidate, "now")),
    buildReason(candidate, "now"),
  );
});
