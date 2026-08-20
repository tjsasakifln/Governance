import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli } from "../src/cli.js";
import { BAND_LABELS, composeHoje } from "../src/compose.js";
import { loadNamedFixture } from "../src/fixtures.js";

test("dump incendio-operacional twice matches and lists eight bands plus founder pin", () => {
  const first = runCli(["dump", "incendio-operacional"]);
  const second = runCli(["dump", "incendio-operacional"]);
  assert.equal(first.code, 0);
  assert.equal(second.code, 0);
  assert.equal(first.stdout, second.stdout);
  const parsed = JSON.parse(first.stdout) as ReturnType<typeof composeHoje>;
  assert.deepEqual(
    parsed.bands.map((b) => b.label),
    [...BAND_LABELS],
  );
  const expected = composeHoje(loadNamedFixture("incendio-operacional"));
  assert.deepEqual(parsed, expected);
  const top3 = parsed.bands[0];
  assert.ok(top3);
  assert.equal(top3.rows[0]?.title, expected.bands[0]?.rows[0]?.title);
  assert.equal(top3.rows[0]?.founder_override_visible, true);
  const staleTones = parsed.bands.flatMap((b) => b.rows).filter((r) => r.freshness_status !== "FRESH");
  for (const row of staleTones) {
    assert.notEqual(row.freshness_tone, "green");
  }
  assert.equal(parsed.charts_emitted, false);
});

test("page incendio-operacional is filled HTML with classic script and no charts", () => {
  const result = runCli(["page", "incendio-operacional"]);
  assert.equal(result.code, 0);
  for (const label of BAND_LABELS) {
    assert.ok(result.stdout.includes(label), label);
  }
  assert.match(result.stdout, /<script src="\.\/hoje\.js">/);
  assert.doesNotMatch(result.stdout, /type="module"/);
  assert.doesNotMatch(result.stdout, /<canvas/i);
  assert.match(result.stdout, /Prioridade do founder: pin/);
  assert.match(result.stdout, /id="hoje"/);
});
