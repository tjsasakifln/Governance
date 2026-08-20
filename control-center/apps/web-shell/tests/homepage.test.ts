import assert from "node:assert/strict";
import { test } from "node:test";
import { ATTENTION_FIXTURES, PRIORITY_FIXTURES } from "../src/fixtures/catalog";
import {
  HOMEPAGE_PRIORITY_LIMIT,
  hasOpenHighSeverity,
  selectHojeModel,
  selectHomepageAttention,
  selectHomepagePriorities,
} from "../src/homepage";

test("Hoje selection yields ranked exceptions and at most three priorities", () => {
  assert.equal(hasOpenHighSeverity(ATTENTION_FIXTURES), true);
  const model = selectHojeModel({
    attention: ATTENTION_FIXTURES,
    priorities: PRIORITY_FIXTURES,
  });
  assert.ok(model.attention.length > 0);
  assert.ok(model.priorities.length > 0);
  assert.ok(model.priorities.length <= HOMEPAGE_PRIORITY_LIMIT);
  assert.equal(HOMEPAGE_PRIORITY_LIMIT, 3);
  assert.deepEqual(
    model.priorities.map((item) => item.rank),
    [1, 2, 3],
  );
  assert.equal(
    model.priorities.some((item) => item.rank === 4),
    false,
  );
  assert.equal(
    model.attention.some((item) => item.status === "resolved"),
    false,
  );
  assert.equal(model.attention[0]?.severity, "critical");
  assert.equal(model.attention[1]?.severity, "high");
  const ids = model.attention.map((item) => item.id);
  assert.ok(ids.includes("cc:attention-item:01K3CC-OVERDUE-INVOICE"));
  assert.ok(ids.includes("cc:attention-item:01K3CC-FAILING-CHECK"));
});

test("selectHomepageAttention and selectHomepagePriorities are the shipped ranking functions", () => {
  const attention = selectHomepageAttention(ATTENTION_FIXTURES);
  const priorities = selectHomepagePriorities(PRIORITY_FIXTURES);
  assert.equal(
    attention.every((item) => item.homepage_eligible),
    true,
  );
  assert.equal(priorities.length, 3);
  assert.equal(priorities[0]?.title.includes("inbound"), true);
});
