import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_FILTER, filterDirectives } from "../src/filter.ts";
import { FIXTURE_DIRECTIVES } from "../src/fixtures.ts";
import { makeSession } from "./helpers.ts";

test("lists fixtures from the mock store start state", () => {
  const session = makeSession();
  const listed = session.service.list();
  assert.equal(listed.length, FIXTURE_DIRECTIVES.length);
  assert.ok(listed.some((row) => row.kind === "decision"));
  assert.ok(listed.some((row) => row.kind === "hypothesis"));
});

test("filters by kind, scope, and status from the real list", () => {
  const session = makeSession();
  const decisions = session.service.list({ ...EMPTY_FILTER, kind: "decision" });
  assert.ok(decisions.length >= 1);
  assert.ok(decisions.every((row) => row.kind === "decision"));

  const finance = session.service.list({ ...EMPTY_FILTER, scope: "finance" });
  assert.ok(finance.length >= 1);
  assert.ok(finance.every((row) => row.scope === "finance"));
  assert.ok(finance.some((row) => row.id === "cc:directive:01K3CC-NO-PROVIDER-MUTATION"));

  const superseded = session.service.list({ ...EMPTY_FILTER, status: "superseded" });
  assert.ok(superseded.length >= 1);
  assert.ok(superseded.every((row) => row.status === "superseded"));
  assert.ok(superseded.some((row) => row.id === "cc:directive:01K3CC-GOV-CANONICAL-OLD"));
});

test("search matches title and body via shipped filterDirectives", () => {
  const byBody = filterDirectives(FIXTURE_DIRECTIVES, {
    ...EMPTY_FILTER,
    query: "read models",
  });
  assert.equal(byBody.length, 1);
  assert.equal(byBody[0]?.kind, "fact");
  assert.equal(byBody[0]?.scope, "commercial");
  assert.equal(byBody[0]?.id, "cc:directive:01K3CC-WARMBLY-CRM");

  const byId = filterDirectives(FIXTURE_DIRECTIVES, {
    ...EMPTY_FILTER,
    query: "01K3CC-NO-PROVIDER-MUTATION",
  });
  assert.equal(byId.length, 1);
  assert.equal(byId[0]?.kind, "constraint");
});

test("combined filters do not leak other kinds or scopes", () => {
  const session = makeSession();
  const rows = session.service.list({
    query: "hipótese",
    kind: "hypothesis",
    scope: "commercial",
    status: "active",
  });
  assert.equal(rows.length, 0);
  const byKind = session.service.list({
    ...EMPTY_FILTER,
    kind: "hypothesis",
    scope: "commercial",
    status: "active",
  });
  assert.equal(byKind.length, 1);
  assert.equal(byKind[0]?.id, "cc:directive:01K3CC-OFFER-HYPOTHESIS");
});
