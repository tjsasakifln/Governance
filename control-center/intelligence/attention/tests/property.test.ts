import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareAttention,
  isDadosStaleTitle,
  rankFromUnknown,
  scoreMilliFromBreakdown,
} from "../src/index.js";
import type { AttentionSignal, RankedItem, ScoredCandidate } from "../src/types.js";
import { idsOf, makeSignal, request } from "./helpers.js";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = arr[i];
    const swap = arr[j];
    if (tmp === undefined || swap === undefined) {
      continue;
    }
    arr[i] = swap;
    arr[j] = tmp;
  }
  return arr;
}

function bag(): AttentionSignal[] {
  return [
    makeSignal({
      id: "cc:attention-signal:p-outage",
      category: "risco_operacional",
      domain: "infrastructure",
      impact: 90,
      urgency: 95,
      severity: "critical",
    }),
    makeSignal({
      id: "cc:attention-signal:p-invoice-a",
      category: "receita",
      domain: "finance",
      impact: 80,
      urgency: 60,
      correlation_key: "inv-1",
    }),
    makeSignal({
      id: "cc:attention-signal:p-invoice-b",
      category: "receita",
      domain: "finance",
      impact: 70,
      urgency: 85,
      correlation_key: "inv-1",
    }),
    makeSignal({
      id: "cc:attention-signal:p-churn",
      category: "cliente",
      domain: "clients",
      impact: 65,
      urgency: 40,
    }),
    makeSignal({
      id: "cc:attention-signal:p-deadline",
      category: "prazo",
      domain: "inbound",
      impact: 55,
      urgency: 80,
    }),
    makeSignal({
      id: "cc:attention-signal:p-css",
      category: "estetica",
      domain: "engineering",
      impact: 20,
      urgency: 99,
    }),
    makeSignal({
      id: "cc:attention-signal:p-stale",
      category: "receita",
      domain: "finance",
      impact: 75,
      urgency: 40,
      freshness_status: "STALE",
      correlation_key: "stale-book",
    }),
  ];
}

function asCandidate(item: RankedItem): ScoredCandidate {
  return {
    id: item.id,
    title: item.title,
    summary: item.title,
    category: item.category,
    domain: item.domain,
    scope: item.scope,
    impact: item.score_breakdown.impact,
    urgency: item.score_breakdown.urgency,
    severity: item.severity,
    status: item.status,
    item_kind: item.item_kind,
    correlation_key: item.id,
    evidence_refs: item.evidence_refs,
    provenance: item.provenance,
    related_ids: [],
    source_ids: item.attention_item_ids,
    merge_count: item.merge_count,
    forced_by_kill_rule: item.forced_by_kill_rule,
    score_milli: item.score_milli,
    breakdown: item.score_breakdown,
  };
}

function assertExplanationsConsistent(items: RankedItem[]): void {
  for (const item of items) {
    assert.equal(scoreMilliFromBreakdown(item.score_breakdown), item.score_milli);
  }
  for (let i = 0; i < items.length - 1; i += 1) {
    const a = items[i];
    const b = items[i + 1];
    assert.ok(a && b);
    assert.ok(compareAttention(asCandidate(a), asCandidate(b)) < 0);
  }
}

test("permutation of input does not change ordered ids (stable tie-break)", () => {
  const base = bag();
  const expected = rankFromUnknown(request({ signals: base }));
  const rand = mulberry32(20260820);
  for (let i = 0; i < 48; i += 1) {
    const shuffled = shuffle(base, rand);
    const got = rankFromUnknown(request({ signals: shuffled }));
    assert.deepEqual(idsOf(got.attention_now), idsOf(expected.attention_now), `now mismatch seed iter ${i}`);
    assert.deepEqual(idsOf(got.today), idsOf(expected.today), `today mismatch seed iter ${i}`);
    assert.deepEqual(
      got.attention_now.map((x) => x.score_milli),
      expected.attention_now.map((x) => x.score_milli),
    );
    assertExplanationsConsistent(got.attention_now);
  }
});

test("duplicate/correlated signals never appear as competing rows", () => {
  const signals = [
    makeSignal({
      id: "cc:attention-signal:dup-a",
      category: "cliente",
      domain: "clients",
      impact: 40,
      urgency: 40,
      correlation_key: "same-client",
    }),
    makeSignal({
      id: "cc:attention-signal:dup-b",
      category: "cliente",
      domain: "clients",
      impact: 60,
      urgency: 10,
      correlation_key: "same-client",
    }),
    makeSignal({
      id: "cc:attention-signal:dup-c",
      category: "cliente",
      domain: "clients",
      impact: 20,
      urgency: 90,
      correlation_key: "same-client",
    }),
  ];
  const out = rankFromUnknown(request({ signals }));
  const work = out.attention_now.filter((i) => i.item_kind === "work");
  assert.equal(work.length, 1);
  assert.equal(work[0]?.merge_count, 3);
  assert.equal(work[0]?.score_breakdown.impact, 60);
  assert.equal(work[0]?.score_breakdown.urgency, 90);
});

test("all-same-domain bag still fills today-N from that domain", () => {
  const signals = [0, 1, 2, 3, 4].map((i) =>
    makeSignal({
      id: `cc:attention-signal:same-${i}`,
      category: "receita",
      domain: "finance",
      impact: 50 + i,
      urgency: 40 + i,
    }),
  );
  const out = rankFromUnknown(request({ signals }));
  assert.equal(out.today.length, 3);
  assert.ok(out.today.every((i) => i.domain === "finance"));
  assertExplanationsConsistent(out.today);
});

test("all-stale bag yields dados stale items and demotes originals", () => {
  const signals = [
    makeSignal({
      id: "cc:attention-signal:stale-a",
      category: "receita",
      domain: "finance",
      impact: 70,
      urgency: 40,
      freshness_status: "STALE",
    }),
    makeSignal({
      id: "cc:attention-signal:stale-b",
      category: "cliente",
      domain: "clients",
      impact: 60,
      urgency: 40,
      freshness_status: "ERROR",
    }),
    makeSignal({
      id: "cc:attention-signal:stale-c",
      category: "prazo",
      domain: "inbound",
      impact: 50,
      urgency: 50,
      freshness_status: "UNKNOWN",
    }),
  ];
  const out = rankFromUnknown(request({ signals }));
  const all = [...out.attention_now, ...out.today];
  const dados = all.filter((i) => i.item_kind === "dados_stale" || isDadosStaleTitle(i.title));
  assert.ok(dados.length >= 1, "all-stale bag must emit dados stale");
  const originals = out.attention_now.filter((i) => i.item_kind === "work");
  for (const item of originals) {
    assert.equal(item.score_breakdown.freshness_demoted, true);
    assert.ok(item.score_breakdown.freshness_multiplier < 1);
  }
});

test("founder override vs kill-rule: pin does not hide the kill-rule from ATENÇÃO AGORA", () => {
  const kill = makeSignal({
    id: "cc:attention-signal:kill-me",
    category: "blocker",
    domain: "infrastructure",
    impact: 80,
    urgency: 80,
    severity: "critical",
  });
  const cosmetic = makeSignal({
    id: "cc:attention-signal:pin-me",
    category: "estetica",
    domain: "engineering",
    impact: 10,
    urgency: 10,
  });
  const other = makeSignal({
    id: "cc:attention-signal:other-work",
    category: "cliente",
    domain: "clients",
    impact: 50,
    urgency: 50,
  });
  const out = rankFromUnknown(
    request({
      signals: [kill, cosmetic, other],
      override: {
        actor: { kind: "human", id: "human:founder" },
        at: "2026-08-20T16:00:00.000Z",
        action: "pin",
        target_ids: [cosmetic.id],
      },
    }),
  );
  assert.equal(out.today[0]?.id, cosmetic.id);
  const nowIds = idsOf(out.attention_now);
  assert.ok(nowIds.includes(kill.id), "kill-rule vanished from ATENÇÃO AGORA after pin");
  const killItem = out.attention_now.find((i) => i.id === kill.id);
  assert.equal(killItem?.forced_by_kill_rule, true);
  assert.equal(out.audit[0]?.actor.id, "human:founder");
  assert.ok(out.audit[0]?.detail.previous_ranking.now.includes(kill.id));
});

test("explanations remain consistent with scores across adversarial mixes", () => {
  const rand = mulberry32(99);
  const categories = ["receita", "cliente", "prazo", "risco_operacional", "blocker", "estetica", "refactor"] as const;
  const domains = ["finance", "commercial", "clients", "infrastructure", "engineering", "inbound", "company"] as const;
  const freshness = ["FRESH", "STALE", "UNKNOWN", "ERROR"] as const;
  const signals: AttentionSignal[] = [];
  for (let i = 0; i < 24; i += 1) {
    const cat = categories[Math.floor(rand() * categories.length)] ?? "receita";
    const domain = domains[Math.floor(rand() * domains.length)] ?? "company";
    const fresh = freshness[Math.floor(rand() * freshness.length)] ?? "FRESH";
    signals.push(
      makeSignal({
        id: `cc:attention-signal:adv-${i}`,
        category: cat,
        domain,
        impact: Math.floor(rand() * 101),
        urgency: Math.floor(rand() * 101),
        severity: cat === "risco_operacional" && rand() > 0.5 ? "critical" : "medium",
        freshness_status: fresh,
        correlation_key: rand() > 0.8 ? "shared-adv" : `adv-${i}`,
        confidence: Math.round(rand() * 100) / 100,
      }),
    );
  }
  const out = rankFromUnknown(request({ signals }));
  assert.ok(out.today.length <= 3);
  assertExplanationsConsistent(out.attention_now);
  assertExplanationsConsistent(out.today);
});
