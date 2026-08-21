import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli } from "../src/cli.ts";
import { createStoreFromEnv } from "../src/store/from-env.ts";
import { ServiceError } from "../src/errors.ts";
import {
  REPRESENTATIVE_IDS,
  REPRESENTATIVE_SCOPE,
  SIBLING_SCOPE,
} from "../src/representative.ts";

const ENV: NodeJS.ProcessEnv = {
  CONTROL_CENTER_FOUNDER_ACTOR_ID: "founder-local",
  CONTEXT_ACTOR_ID: "agent-session-launch",
  CONTEXT_ACTOR_KIND: "agent",
  CONTEXT_SERVICE_FIXTURE: "representative",
};

function parse(json: string): Record<string, unknown> {
  return JSON.parse(json) as Record<string, unknown>;
}

test("shipped CLI get_context is deterministic and minimum-sufficient for the representative scope", () => {
  const args = ["get_context", "--scope", REPRESENTATIVE_SCOPE];
  const first = runCli(args, ENV);
  const second = runCli(args, ENV);
  assert.equal(first, second);

  const ctx = parse(first) as {
    scope: string;
    active_directives: Array<{
      id: string;
      kind: string;
      source: { system: string; kind: string; locator: string };
      observed_at: string;
      freshness_status: string;
      confidence: number;
      created_by: { kind: string; id: string };
    }>;
    decisions: Array<{ id: string; kind: string }>;
    facts: Array<{ id: string; kind: string }>;
    hypotheses: Array<{ id: string; kind: string }>;
    constraints: Array<{ id: string; kind: string }>;
    priorities: Array<{ id: string; kind: string }>;
    directives: Array<{ id: string }>;
  };

  assert.equal(typeof ctx.scope, "string");
  assert.equal(ctx.scope, REPRESENTATIVE_SCOPE);

  const ids = ctx.active_directives.map((d) => d.id);
  assert.ok(ids.includes(REPRESENTATIVE_IDS.companyPriority));
  assert.ok(ids.includes(REPRESENTATIVE_IDS.companyDecision));
  assert.ok(ids.includes(REPRESENTATIVE_IDS.domainDirective));
  assert.ok(ids.includes(REPRESENTATIVE_IDS.resourceFact));
  assert.ok(ids.includes(REPRESENTATIVE_IDS.activeConstraint));
  assert.ok(ids.includes(REPRESENTATIVE_IDS.collectionError));
  assert.equal(ids.includes(REPRESENTATIVE_IDS.expired), false);
  assert.equal(ids.includes(REPRESENTATIVE_IDS.supersededConstraint), false);
  assert.equal(ids.includes(REPRESENTATIVE_IDS.siblingFact), false);
  assert.equal(ids.includes(REPRESENTATIVE_IDS.clientFact), false);
  assert.ok(ids.includes(REPRESENTATIVE_IDS.hypothesis));

  assert.ok(ctx.hypotheses.every((d) => d.kind === "hypothesis"));
  assert.ok(ctx.decisions.every((d) => d.kind === "decision"));
  assert.ok(ctx.facts.every((d) => d.kind === "fact"));
  assert.equal(
    ctx.decisions.some((d) => d.id === REPRESENTATIVE_IDS.hypothesis),
    false,
  );
  assert.equal(
    ctx.facts.some((d) => d.id === REPRESENTATIVE_IDS.hypothesis),
    false,
  );
  assert.ok(ctx.constraints.some((d) => d.id === REPRESENTATIVE_IDS.activeConstraint));
  assert.ok(ctx.priorities.some((d) => d.id === REPRESENTATIVE_IDS.companyPriority));

  for (const item of ctx.active_directives) {
    assert.match(item.id, /^cc:/);
    assert.equal(typeof item.source, "object");
    assert.equal(typeof item.source.system, "string");
    assert.match(item.observed_at, /Z$/);
    assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(item.freshness_status));
    assert.equal(typeof item.confidence, "number");
    assert.ok(["human", "agent", "system"].includes(item.created_by.kind));
  }
  const errorItem = ctx.active_directives.find((d) => d.id === REPRESENTATIVE_IDS.collectionError);
  assert.equal(errorItem?.freshness_status, "ERROR");
});

test("shipped CLI get_active_directives, get_priorities and get_decisions match policy", () => {
  const active = parse(runCli(["get_active_directives", "--scope", REPRESENTATIVE_SCOPE], ENV)) as {
    items: Array<{ id: string; kind: string }>;
  };
  const priorities = parse(runCli(["get_priorities"], ENV)) as { items: Array<{ id: string; kind: string }> };
  const decisions = parse(runCli(["get_decisions"], ENV)) as { items: Array<{ id: string; kind: string }> };
  const sibling = parse(runCli(["get_active_directives", "--scope", SIBLING_SCOPE], ENV)) as {
    items: Array<{ id: string }>;
  };

  assert.ok(active.items.some((d) => d.id === REPRESENTATIVE_IDS.resourceFact));
  assert.equal(
    active.items.some((d) => d.id === REPRESENTATIVE_IDS.siblingFact),
    false,
  );
  assert.equal(
    active.items.some((d) => d.id === REPRESENTATIVE_IDS.expired),
    false,
  );
  assert.equal(
    active.items.some((d) => d.id === REPRESENTATIVE_IDS.supersededConstraint),
    false,
  );
  assert.ok(sibling.items.some((d) => d.id === REPRESENTATIVE_IDS.siblingFact));
  assert.equal(
    sibling.items.some((d) => d.id === REPRESENTATIVE_IDS.resourceFact),
    false,
  );
  assert.ok(priorities.items.every((d) => d.kind === "priority"));
  assert.ok(priorities.items.some((d) => d.id === REPRESENTATIVE_IDS.companyPriority));
  assert.ok(decisions.items.every((d) => d.kind === "decision"));
  assert.ok(decisions.items.some((d) => d.id === REPRESENTATIVE_IDS.companyDecision));
  assert.equal(
    decisions.items.some((d) => d.id === REPRESENTATIVE_IDS.hypothesis),
    false,
  );
});

test("CLI rejects legacy company/domain/resource flags", () => {
  assert.throws(
    () => runCli(["get_context", "--company", "confenge", "--domain", "commercial"], ENV),
    (err: unknown) => err instanceof ServiceError && err.code === "invalid_input",
  );
});

test("DATABASE_URL refuses fixture fallback", () => {
  assert.throws(
    () => createStoreFromEnv({ DATABASE_URL: "postgresql://localhost/control_center" }),
    (err: unknown) => err instanceof ServiceError && err.code === "store_misconfigured",
  );
});
