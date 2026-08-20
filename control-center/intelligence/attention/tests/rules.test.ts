import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isDadosStaleTitle,
  rankFromUnknown,
  scoreMilliFromBreakdown,
} from "../src/index.js";
import { PRIMARY_CATEGORIES, SECONDARY_CATEGORIES } from "../src/taxonomy.js";
import { idsOf, makeSignal, request } from "./helpers.js";

test("per-category weight change alters order", () => {
  const signals = [
    makeSignal({
      id: "cc:attention-signal:receita-mid",
      category: "receita",
      domain: "finance",
      impact: 50,
      urgency: 50,
    }),
    makeSignal({
      id: "cc:attention-signal:cliente-mid",
      category: "cliente",
      domain: "clients",
      impact: 50,
      urgency: 50,
    }),
  ];
  const baseline = rankFromUnknown(request({ signals }));
  assert.equal(baseline.attention_now[0]?.id, "cc:attention-signal:receita-mid");
  const flipped = rankFromUnknown(
    request({
      signals,
      config: { category_weights: { cliente: 400 } },
    }),
  );
  assert.equal(flipped.attention_now[0]?.id, "cc:attention-signal:cliente-mid");
  const a = flipped.attention_now[0];
  const b = flipped.attention_now[1];
  assert.ok(a && b);
  assert.ok(scoreMilliFromBreakdown(a.score_breakdown) > scoreMilliFromBreakdown(b.score_breakdown));
});

test("receita/cliente/prazo/risco_operacional/blocker beat estetica/refactor", () => {
  const primaries = PRIMARY_CATEGORIES.map((category) =>
    makeSignal({
      id: `cc:attention-signal:primary-${category}`,
      category,
      domain: "company",
      impact: 5,
      urgency: 0,
      severity: category === "risco_operacional" || category === "blocker" ? "medium" : "low",
    }),
  );
  const secondaries = SECONDARY_CATEGORIES.map((category) =>
    makeSignal({
      id: `cc:attention-signal:secondary-${category}`,
      category,
      domain: "engineering",
      impact: 100,
      urgency: 100,
    }),
  );
  const out = rankFromUnknown(request({ signals: [...primaries, ...secondaries] }));
  const ranked = out.attention_now;
  const primaryIds = new Set(primaries.map((p) => p.id));
  const lastPrimary = Math.max(
    ...ranked.map((item, idx) => (primaryIds.has(item.id) ? idx : -1)),
  );
  const firstSecondary = Math.min(
    ...ranked.map((item, idx) => (primaryIds.has(item.id) ? Number.POSITIVE_INFINITY : idx)),
  );
  assert.ok(lastPrimary < firstSecondary, "a secondary item ranked above a primary item");
  for (const item of ranked) {
    if (primaryIds.has(item.id)) {
      assert.equal(item.score_breakdown.category_tier, 2);
    } else {
      assert.equal(item.score_breakdown.category_tier, 1);
    }
  }
});

test("high-urgency low-impact item does not beat higher-impact higher-category on urgency alone", () => {
  const highImpact = makeSignal({
    id: "cc:attention-signal:high-impact-receita",
    category: "receita",
    domain: "finance",
    impact: 80,
    urgency: 5,
  });
  const urgentCosmetic = makeSignal({
    id: "cc:attention-signal:urgent-estetica",
    category: "estetica",
    domain: "engineering",
    impact: 10,
    urgency: 100,
  });
  const urgentLowerCat = makeSignal({
    id: "cc:attention-signal:urgent-cliente",
    category: "cliente",
    domain: "clients",
    impact: 15,
    urgency: 100,
  });
  const out = rankFromUnknown(request({ signals: [urgentCosmetic, urgentLowerCat, highImpact] }));
  const ids = idsOf(out.attention_now);
  assert.equal(ids[0], "cc:attention-signal:high-impact-receita");
  const a = out.attention_now[0];
  const cosmetic = out.attention_now.find((i) => i.id === urgentCosmetic.id);
  const lower = out.attention_now.find((i) => i.id === urgentLowerCat.id);
  assert.ok(a && cosmetic && lower);
  assert.ok(a.score_breakdown.category_tier > cosmetic.score_breakdown.category_tier);
  assert.ok(
    scoreMilliFromBreakdown(a.score_breakdown) > scoreMilliFromBreakdown(lower.score_breakdown),
    "receita high-impact lost to cliente high-urgency on score",
  );
  assert.ok(a.score_breakdown.urgency < lower.score_breakdown.urgency);
  assert.ok(a.score_breakdown.impact > lower.score_breakdown.impact);
});

test("correlated signals merge to one ranked item", () => {
  const a = makeSignal({
    id: "cc:attention-signal:merge-a",
    category: "receita",
    domain: "finance",
    impact: 40,
    urgency: 20,
    correlation_key: "invoice:same",
  });
  const b = makeSignal({
    id: "cc:attention-signal:merge-b",
    category: "receita",
    domain: "finance",
    impact: 70,
    urgency: 90,
    correlation_key: "invoice:same",
  });
  const other = makeSignal({
    id: "cc:attention-signal:other",
    category: "cliente",
    domain: "clients",
    impact: 30,
    urgency: 30,
  });
  const out = rankFromUnknown(request({ signals: [b, other, a] }));
  const merged = out.attention_now.find((i) => i.merge_count === 2);
  assert.ok(merged, "expected a merged item");
  assert.equal(merged.merge_count, 2);
  assert.equal(merged.score_breakdown.merge_count, 2);
  assert.equal(merged.score_breakdown.impact, 70);
  assert.equal(merged.score_breakdown.urgency, 90);
  assert.ok(merged.attention_item_ids.includes("cc:attention-signal:merge-a"));
  assert.ok(merged.attention_item_ids.includes("cc:attention-signal:merge-b"));
  const competing = out.attention_now.filter(
    (i) => i.id === a.id || i.id === b.id || i.merge_count === 2,
  );
  assert.equal(competing.length, 1, "merged signals must not compete as separate items");
});

test("today-3 from a same-domain-heavy bag still includes another domain when eligible", () => {
  const finance: ReturnType<typeof makeSignal>[] = [];
  for (let i = 0; i < 5; i += 1) {
    finance.push(
      makeSignal({
        id: `cc:attention-signal:fin-${i}`,
        category: "receita",
        domain: "finance",
        impact: 90 - i,
        urgency: 80 - i,
      }),
    );
  }
  const client = makeSignal({
    id: "cc:attention-signal:client-only",
    category: "cliente",
    domain: "clients",
    impact: 40,
    urgency: 40,
  });
  const out = rankFromUnknown(request({ signals: [...finance, client] }));
  assert.equal(out.today.length, 3);
  const domains = new Set(out.today.map((i) => i.domain));
  assert.ok(domains.has("clients"), `today domains were ${[...domains].join(",")}`);
  assert.ok(domains.has("finance"));
  assert.ok(idsOf(out.today).includes("cc:attention-signal:client-only"));
});

test("critical-risk kill rule appears in ATENÇÃO AGORA against low-value work", () => {
  const cosmetics = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
    makeSignal({
      id: `cc:attention-signal:cosmetic-${i}`,
      category: "estetica",
      domain: "engineering",
      impact: 100,
      urgency: 100,
    }),
  );
  const critical = makeSignal({
    id: "cc:attention-signal:kill-outage",
    category: "risco_operacional",
    domain: "infrastructure",
    impact: 20,
    urgency: 10,
    severity: "critical",
  });
  const out = rankFromUnknown(request({ signals: [...cosmetics, critical] }));
  const kill = out.attention_now.find((i) => i.id === critical.id);
  assert.ok(kill, "kill-rule item missing from ATENÇÃO AGORA");
  assert.equal(kill.forced_by_kill_rule, true);
  assert.equal(out.attention_now[0]?.id, critical.id);
  assert.ok(kill.reason.includes("KILL-RULE"));
});

test("stale freshness demotes the original and yields a dados stale item", () => {
  const stale = makeSignal({
    id: "cc:attention-signal:stale-book",
    category: "receita",
    domain: "finance",
    impact: 80,
    urgency: 50,
    freshness_status: "STALE",
    confidence: 0.6,
  });
  const freshPeer = makeSignal({
    id: "cc:attention-signal:fresh-peer",
    category: "receita",
    domain: "finance",
    impact: 80,
    urgency: 50,
    freshness_status: "FRESH",
    confidence: 0.6,
    correlation_key: "other",
  });
  const out = rankFromUnknown(request({ signals: [stale, freshPeer] }));
  const original = [...out.attention_now, ...out.today].find((i) => i.id === stale.id);
  assert.ok(original);
  assert.equal(original.score_breakdown.freshness_demoted, true);
  assert.equal(original.score_breakdown.freshness_status, "STALE");
  assert.ok(original.score_breakdown.freshness_multiplier < 1);
  const peer = out.attention_now.find((i) => i.id === freshPeer.id);
  assert.ok(peer);
  assert.ok(
    scoreMilliFromBreakdown(peer.score_breakdown) >
      scoreMilliFromBreakdown(original.score_breakdown),
  );
  const dados = [...out.attention_now, ...out.today].find(
    (i) => i.item_kind === "dados_stale" || isDadosStaleTitle(i.title),
  );
  assert.ok(dados, "expected an explicit dados stale item");
  assert.ok(dados.title.startsWith("Dados stale:"));
  assert.ok(dados.reason.toLowerCase().includes("stale"));
});

test("founder override pins a target and records actor, time, target, previous ranking", () => {
  const a = makeSignal({
    id: "cc:attention-signal:alpha",
    category: "receita",
    domain: "finance",
    impact: 90,
    urgency: 90,
  });
  const b = makeSignal({
    id: "cc:attention-signal:beta",
    category: "cliente",
    domain: "clients",
    impact: 40,
    urgency: 40,
  });
  const c = makeSignal({
    id: "cc:attention-signal:gamma",
    category: "prazo",
    domain: "inbound",
    impact: 30,
    urgency: 30,
  });
  const baseline = rankFromUnknown(request({ signals: [a, b, c] }));
  const pinId = "cc:attention-signal:gamma";
  assert.notEqual(baseline.today[0]?.id, pinId);
  const out = rankFromUnknown(
    request({
      signals: [a, b, c],
      override: {
        actor: { kind: "human", id: "human:founder" },
        at: "2026-08-20T15:05:00.000Z",
        action: "pin",
        target_ids: [pinId],
      },
    }),
  );
  assert.equal(out.today[0]?.id, pinId);
  assert.equal(out.audit.length, 1);
  const audit = out.audit[0];
  assert.ok(audit);
  assert.equal(audit.actor.id, "human:founder");
  assert.equal(audit.at, "2026-08-20T15:05:00.000Z");
  assert.deepEqual(audit.detail.target_ids, [pinId]);
  assert.deepEqual(audit.detail.previous_ranking.today, idsOf(baseline.today));
  assert.deepEqual(audit.detail.previous_ranking.now, idsOf(baseline.attention_now));
  assert.deepEqual(audit.detail.resulting_ranking.today, idsOf(out.today));
  assert.equal(audit.action, "founder_override");
});

test("v1 ranking path has no LLM-shaped fields or generative hooks", () => {
  const srcHints = ["prompt", "openai", "anthropic", "llm", "chat.completions"];
  const out = rankFromUnknown(
    request({
      signals: [
        makeSignal({
          id: "cc:attention-signal:plain",
          category: "receita",
          domain: "finance",
          impact: 10,
          urgency: 10,
        }),
      ],
    }),
  );
  const blob = JSON.stringify(out).toLowerCase();
  for (const hint of srcHints) {
    assert.equal(blob.includes(hint), false, `output leaked ${hint}`);
  }
});

test("each output item carries source, observed_at, freshness_status, confidence", () => {
  const out = rankFromUnknown(
    request({
      signals: [
        makeSignal({
          id: "cc:attention-signal:prov",
          category: "cliente",
          domain: "clients",
          impact: 20,
          urgency: 20,
        }),
      ],
    }),
  );
  assert.equal(out.provenance.source.system, "governance");
  assert.equal(out.provenance.freshness_status, "FRESH");
  assert.equal(out.provenance.confidence, 1);
  const item = out.attention_now[0];
  assert.ok(item);
  assert.ok(item.provenance.source.system);
  assert.ok(item.provenance.observed_at);
  assert.ok(item.provenance.freshness_status);
  assert.equal(typeof item.provenance.confidence, "number");
});
