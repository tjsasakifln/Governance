import assert from "node:assert/strict";
import { test } from "node:test";
import {
  previewAgentContext,
  previewHasHypothesisMixedIntoAuthoritative,
  previewTitle,
} from "../src/preview.ts";
import { FIXTURE_DIRECTIVES, FIXTURE_NOW } from "../src/fixtures.ts";
import { frozenClock } from "../src/datetime.ts";
import { makeSession } from "./helpers.ts";

test("preview is titled for the requested scope and is not a company dump", () => {
  const session = makeSession();
  const preview = session.service.preview("commercial");
  assert.equal(preview.title, previewTitle("commercial"));
  assert.equal(preview.scope, "commercial");
  assert.deepEqual(preview.granted_scopes, ["commercial"]);
  assert.ok(preview.excluded_other_scopes > 0);
  const ids = [
    ...preview.decisions,
    ...preview.directives,
    ...preview.facts,
    ...preview.constraints,
    ...preview.priorities,
    ...preview.risks,
    ...preview.hypotheses,
  ].map((item) => item.record.scope);
  assert.ok(ids.every((scope) => scope === "commercial"));
});

test("hypotheses are not mixed into facts or decisions", () => {
  const preview = previewAgentContext(
    FIXTURE_DIRECTIVES,
    "commercial",
    frozenClock(FIXTURE_NOW),
  );
  assert.equal(preview.facts.length, 1);
  assert.equal(preview.facts[0]?.record.kind, "fact");
  assert.equal(preview.hypotheses.length, 1);
  assert.equal(preview.hypotheses[0]?.record.kind, "hypothesis");
  assert.equal(preview.decisions.length, 0);
  assert.equal(previewHasHypothesisMixedIntoAuthoritative(preview), false);
  assert.equal(preview.facts[0]?.source, "governance");
  assert.ok(preview.facts[0]?.observed_at.endsWith("Z"));
  assert.equal(preview.facts[0]?.freshness_status, "FRESH");
  assert.ok(typeof preview.hypotheses[0]?.confidence === "number");
  assert.ok((preview.hypotheses[0]?.confidence ?? 1) < (preview.facts[0]?.confidence ?? 0));
});

test("drafts and other scopes stay out of the agent preview", () => {
  const session = makeSession();
  const inbound = session.service.preview("inbound");
  assert.equal(inbound.directives.length, 0);
  assert.ok(inbound.excluded_inactive >= 1);
  const company = session.service.preview("company");
  assert.ok(company.decisions.some((item) => item.record.id === "cc:directive:01K3CC-GOV-CANONICAL"));
  assert.ok(
    company.decisions.every((item) => item.record.id !== "cc:directive:01K3CC-GOV-CANONICAL-OLD"),
  );
});
