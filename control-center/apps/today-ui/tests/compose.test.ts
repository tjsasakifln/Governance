import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BAND_LABELS,
  DOMAIN_EXCEPTION_BANDS,
  EXCEPTION_KPI_BANDS,
  HOMEPAGE_PRIORITY_LIMIT,
  allRows,
  bandById,
  composeHoje,
  viewHasUntrustedGreen,
} from "../src/compose.js";
import { loadNamedFixture, FIXTURE_NAMES } from "../src/fixtures.js";
import { freshnessTone } from "../src/freshness.js";
import { renderHojeMain } from "../src/render.js";
import type { FixtureName, HojeView } from "../src/types.js";

function composeNamed(name: FixtureName): HojeView {
  return composeHoje(loadNamedFixture(name));
}

for (const name of FIXTURE_NAMES) {
  test(`compose(${name}) is the shipped path: eight bands in order, Top 3 cap, no charts`, () => {
    const view = composeNamed(name);
    assert.equal(view.schema_version, "control-center.hoje-view.v1");
    assert.equal(view.fixture_name, name);
    assert.deepEqual(
      view.bands.map((b) => b.label),
      [...BAND_LABELS],
    );
    assert.equal(view.bands.length, 8);
    const top3 = bandById(view, "top3");
    assert.ok(top3.rows.length <= HOMEPAGE_PRIORITY_LIMIT);
    assert.equal(HOMEPAGE_PRIORITY_LIMIT, 3);
    assert.equal(view.charts_emitted, false);
    const html = renderHojeMain(view);
    assert.doesNotMatch(html, /<canvas/i);
    assert.doesNotMatch(html, /<svg/i);
    assert.equal(viewHasUntrustedGreen(view), false);
    for (const row of allRows(view)) {
      assert.ok(row.source.system.length > 0);
      assert.ok(row.observed_at.endsWith("Z"));
      assert.ok(row.freshness_status.length > 0);
      if (row.freshness_status !== "FRESH") {
        assert.notEqual(row.freshness_tone, "green");
      }
    }
  });
}

test("dia-saudavel compresses exception/KPI bands so they can be ignored", () => {
  const view = composeNamed("dia-saudavel");
  for (const id of EXCEPTION_KPI_BANDS) {
    const band = bandById(view, id);
    assert.equal(band.compressed, true, `${id} should be compressed`);
  }
  assert.equal(bandById(view, "agents").compressed, true);
  const top3 = bandById(view, "top3");
  assert.ok(top3.rows.length > 0);
  assert.ok(top3.rows.length <= 3);
  assert.equal(top3.compressed, false);
  assert.equal(bandById(view, "shortcuts").compressed, false);
});

test("incendio-operacional expands incidents and at least one domain exception; founder pin is visible", () => {
  const view = composeNamed("incendio-operacional");
  const incidents = bandById(view, "incidents");
  assert.equal(incidents.compressed, false);
  assert.ok(incidents.rows.length >= 1);
  assert.ok(incidents.rows.some((r) => r.kind === "blocker" || r.title.includes("Blocker")));
  assert.ok(incidents.rows.some((r) => r.kind === "risk" || r.title.includes("Risco")));
  assert.equal(
    incidents.rows.some((r) => r.id === "cc:attention-item:01K3CC-FIRE-RESOLVED"),
    false,
  );
  const expandedDomain = DOMAIN_EXCEPTION_BANDS.some((id) => {
    const band = bandById(view, id);
    return band.compressed === false && band.rows.length >= 1;
  });
  assert.equal(expandedDomain, true);
  const top3 = bandById(view, "top3");
  assert.equal(top3.rows.length, 3);
  assert.equal(
    top3.rows.some((r) => r.id === "cc:priority-recommendation:01K3CC-FIRE-COSMETIC"),
    false,
  );
  const pinned = top3.rows.find((r) => r.id === "cc:priority-recommendation:01K3CC-FIRE-RECEIVABLE");
  assert.ok(pinned);
  assert.equal(pinned?.founder_override_visible, true);
  assert.equal(pinned?.founder_override_action, "pin");
  const html = renderHojeMain(view);
  assert.match(html, /Prioridade do founder: pin/);
  const finance = bandById(view, "finance");
  const overdue = finance.rows.find((r) => r.money);
  assert.ok(overdue?.money);
  assert.equal(Number.isInteger(overdue?.money?.amount_cents), true);
  assert.equal(overdue?.money?.currency, "BRL");
  assert.equal(overdue?.money?.amount_cents, 1500000);
});

test("dados-stale maps STALE/UNKNOWN/ERROR to non-green and still shows the data", () => {
  const view = composeNamed("dados-stale");
  const rows = allRows(view);
  assert.ok(rows.length > 0);
  const statuses = new Set(rows.map((r) => r.freshness_status));
  assert.ok(statuses.has("STALE"));
  assert.ok(statuses.has("UNKNOWN"));
  assert.ok(statuses.has("ERROR"));
  for (const row of rows) {
    if (row.freshness_status === "STALE" || row.freshness_status === "UNKNOWN" || row.freshness_status === "ERROR") {
      assert.notEqual(row.freshness_tone, "green", `${row.id} ${row.freshness_status}`);
      assert.notEqual(freshnessTone(row.freshness_status), "green");
    }
  }
  assert.equal(bandById(view, "incidents").compressed, false);
  assert.equal(bandById(view, "commercial").compressed, false);
  assert.equal(bandById(view, "finance").compressed, false);
  assert.equal(bandById(view, "engineering").compressed, false);
  const html = renderHojeMain(view);
  assert.doesNotMatch(html, /data-tone="green"[^>]*STALE/);
  assert.match(html, /data-tone="amber"/);
  assert.match(html, /data-tone="slate"/);
  assert.match(html, /data-tone="red"/);
});

test("zero-atividade does not invent recommended actions or agent rows", () => {
  const view = composeNamed("zero-atividade");
  assert.equal(bandById(view, "top3").rows.length, 0);
  assert.equal(bandById(view, "top3").compressed, true);
  assert.equal(bandById(view, "incidents").rows.length, 0);
  assert.equal(bandById(view, "incidents").compressed, true);
  assert.equal(bandById(view, "clients").rows.length, 0);
  assert.equal(bandById(view, "agents").rows.length, 0);
  assert.equal(bandById(view, "agents").compressed, true);
  assert.match(bandById(view, "agents").compressed_summary ?? "", /não inventar trabalho/i);
  assert.equal(bandById(view, "shortcuts").shortcuts.length, 2);
  assert.equal(allRows(view).length, 0);
});
