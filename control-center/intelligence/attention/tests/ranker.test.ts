import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  compareAttention,
  explainPair,
  rankFromUnknown,
  scoreMilliFromBreakdown,
} from "../src/index.js";
import type { RankedItem, ScoredCandidate } from "../src/types.js";
import { FROZEN_NOW, idsOf, makeSignal, request } from "./helpers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(root, "fixtures", "representative.json");

function asCandidate(item: RankedItem): ScoredCandidate {
  const c: ScoredCandidate = {
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
  return c;
}

test("same input twice yields identical ordered ids and scores", () => {
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
  const a = rankFromUnknown(raw);
  const b = rankFromUnknown(raw);
  assert.deepEqual(idsOf(a.attention_now), idsOf(b.attention_now));
  assert.deepEqual(idsOf(a.today), idsOf(b.today));
  assert.deepEqual(
    a.attention_now.map((i) => i.score_milli),
    b.attention_now.map((i) => i.score_milli),
  );
  assert.deepEqual(
    a.today.map((i) => i.score_milli),
    b.today.map((i) => i.score_milli),
  );
  assert.equal(a.config_fingerprint, b.config_fingerprint);
  assert.equal(a.generated_at, FROZEN_NOW);
});

test("every ranked item carries reason, evidence refs, and reconstructible breakdown", () => {
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
  const out = rankFromUnknown(raw);
  assert.ok(out.attention_now.length > 0);
  assert.ok(out.today.length > 0);
  assert.ok(out.today.length <= 3);
  for (const item of [...out.attention_now, ...out.today]) {
    assert.ok(item.reason.length > 0, `missing reason on ${item.id}`);
    assert.ok(item.evidence_refs.length > 0, `missing evidence on ${item.id}`);
    const reconstructed = scoreMilliFromBreakdown(item.score_breakdown);
    assert.equal(
      reconstructed,
      item.score_milli,
      `breakdown does not reconstruct score for ${item.id}`,
    );
    assert.equal(item.score_breakdown.score_milli, item.score_milli);
    assert.ok(item.provenance.source.system.length > 0);
    assert.ok(item.provenance.observed_at.endsWith("Z"));
    assert.ok(item.provenance.freshness_status);
    assert.ok(item.provenance.confidence >= 0 && item.provenance.confidence <= 1);
  }
});

test("A vs B is explained by emitted breakdown fields, not a hardcoded oracle", () => {
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as unknown;
  const out = rankFromUnknown(raw);
  assert.ok(out.attention_now.length >= 2);
  for (let i = 0; i < out.attention_now.length - 1; i += 1) {
    const a = out.attention_now[i];
    const b = out.attention_now[i + 1];
    assert.ok(a && b);
    const ca = asCandidate(a);
    const cb = asCandidate(b);
    const cmp = compareAttention(ca, cb);
    assert.ok(cmp < 0, `order violation at ${i}: ${explainPair(ca, cb)}`);
    const sa = scoreMilliFromBreakdown(a.score_breakdown);
    const sb = scoreMilliFromBreakdown(b.score_breakdown);
    if (a.forced_by_kill_rule === b.forced_by_kill_rule && a.score_breakdown.category_tier === b.score_breakdown.category_tier) {
      assert.ok(
        sa > sb || (sa === sb && cmp < 0),
        `same-tier pair ${a.id} vs ${b.id}: scores ${sa} ${sb} cmp ${cmp}`,
      );
    }
    if (sa !== sb && a.forced_by_kill_rule === b.forced_by_kill_rule && a.score_breakdown.category_tier === b.score_breakdown.category_tier) {
      assert.ok(sa > sb, `${a.id} ranked above ${b.id} but score_milli ${sa} <= ${sb}`);
    }
  }
});

test("resolved signals are excluded from ranking", () => {
  const out = rankFromUnknown(
    request({
      signals: [
        makeSignal({
          id: "cc:attention-signal:open-one",
          category: "receita",
          domain: "finance",
          impact: 50,
          urgency: 50,
        }),
        makeSignal({
          id: "cc:attention-signal:resolved-one",
          category: "receita",
          domain: "finance",
          impact: 100,
          urgency: 100,
          status: "resolved",
        }),
      ],
    }),
  );
  assert.deepEqual(idsOf(out.attention_now), ["cc:attention-signal:open-one"]);
});

test("rankFromUnknown rejects secret-bearing keys fail-closed", () => {
  assert.throws(
    () =>
      rankFromUnknown({
        now: FROZEN_NOW,
        signals: [
          {
            ...makeSignal({
              id: "cc:attention-signal:x",
              category: "receita",
              domain: "finance",
              impact: 1,
              urgency: 1,
            }),
            password: "nope",
          },
        ],
      }),
    /forbidden secret-bearing key/,
  );
});

test("rankFromUnknown rejects missing provenance", () => {
  assert.throws(
    () =>
      rankFromUnknown({
        now: FROZEN_NOW,
        signals: [
          {
            id: "cc:attention-signal:x",
            title: "x",
            summary: "x",
            category: "receita",
            domain: "finance",
            scope: "finance",
            impact: 1,
            urgency: 1,
            severity: "low",
            status: "open",
            correlation_key: "x",
            evidence_refs: [
              { source: { system: "manual", kind: "note", locator: "x" } },
            ],
          },
        ],
      }),
    /provenance/,
  );
});
