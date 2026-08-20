import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli } from "../src/cli.ts";
import { createStoreFromEnv } from "../src/store/from-env.ts";
import { ServiceError } from "../src/errors.ts";
import {
  REPRESENTATIVE_IDS,
  REPRESENTATIVE_SCOPE,
} from "../src/representative.ts";

const ENV: NodeJS.ProcessEnv = {
  CONTROL_CENTER_FOUNDER_ACTOR_ID: "founder-local",
  CONTEXT_ACTOR_ID: "agent-session-launch",
  CONTEXT_ACTOR_ROLE: "agent",
  CONTEXT_SERVICE_FIXTURE: "representative",
  CONTROL_CENTER_COMPANY: "confenge",
};

function parse(json: string): Record<string, unknown> {
  return JSON.parse(json) as Record<string, unknown>;
}

test("shipped CLI get_context is deterministic and minimum-sufficient for the representative scope", () => {
  const args = [
    "get_context",
    "--company",
    REPRESENTATIVE_SCOPE.company,
    "--domain",
    REPRESENTATIVE_SCOPE.domain ?? "",
    "--resource",
    REPRESENTATIVE_SCOPE.resource ?? "",
  ];
  const first = runCli(args, ENV);
  const second = runCli(args, ENV);
  assert.equal(first, second);

  const ctx = parse(first) as {
    scope: { company: string; domain: string; resource: string };
    active_directives: Array<{
      id: string;
      kind: string;
      source: string;
      observed_at: string;
      freshness_status: string;
    }>;
    decisions: Array<{ id: string; kind: string }>;
    facts: Array<{ id: string; kind: string }>;
    hypotheses: Array<{ id: string; kind: string }>;
    constraints: Array<{ id: string; kind: string }>;
    priorities: Array<{ id: string; kind: string }>;
    directives: Array<{ id: string }>;
  };

  const ids = ctx.active_directives.map((d) => d.id);
  assert.ok(ids.includes(REPRESENTATIVE_IDS.companyPriority));
  assert.ok(ids.includes(REPRESENTATIVE_IDS.companyDecision));
  assert.ok(ids.includes(REPRESENTATIVE_IDS.domainDirective));
  assert.ok(ids.includes(REPRESENTATIVE_IDS.resourceFact));
  assert.ok(ids.includes(REPRESENTATIVE_IDS.activeConstraint));
  assert.equal(ids.includes(REPRESENTATIVE_IDS.expired), false);
  assert.equal(ids.includes(REPRESENTATIVE_IDS.supersededConstraint), false);
  assert.equal(ids.includes(REPRESENTATIVE_IDS.siblingFact), false);
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
    assert.equal(typeof item.source, "string");
    assert.match(item.observed_at, /Z$/);
    assert.ok(["fresh", "stale", "unknown"].includes(item.freshness_status));
  }
});

test("shipped CLI get_active_directives, get_priorities and get_decisions match policy", () => {
  const scopeArgs = [
    "--company",
    "confenge",
    "--domain",
    "commercial",
    "--resource",
    "offer:CFG-DIAG-EXP-v1",
  ];
  const active = parse(runCli(["get_active_directives", ...scopeArgs], ENV)) as {
    items: Array<{ id: string; kind: string }>;
  };
  const priorities = parse(runCli(["get_priorities"], ENV)) as { items: Array<{ id: string; kind: string }> };
  const decisions = parse(runCli(["get_decisions"], ENV)) as { items: Array<{ id: string; kind: string }> };

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
  assert.ok(priorities.items.every((d) => d.kind === "priority"));
  assert.ok(priorities.items.some((d) => d.id === REPRESENTATIVE_IDS.companyPriority));
  assert.ok(decisions.items.every((d) => d.kind === "decision"));
  assert.ok(decisions.items.some((d) => d.id === REPRESENTATIVE_IDS.companyDecision));
  assert.equal(
    decisions.items.some((d) => d.id === REPRESENTATIVE_IDS.hypothesis),
    false,
  );
});

test("DATABASE_URL refuses fixture fallback", () => {
  assert.throws(
    () => createStoreFromEnv({ DATABASE_URL: "postgresql://localhost/control_center" }),
    (err: unknown) => err instanceof ServiceError && err.code === "store_misconfigured",
  );
});
