import assert from "node:assert/strict";
import { test } from "node:test";
import { draftImpact, draftToInput } from "../src/create.ts";
import { isDirectiveUiError } from "../src/errors.ts";
import { DIRECTIVE_KINDS } from "../src/types.ts";
import { createInput, makeSession } from "./helpers.ts";

test("creates all seven kinds with required fields and defaults from the service", () => {
  const session = makeSession();
  for (const kind of DIRECTIVE_KINDS) {
    const rec = session.service.create(
      createInput(kind, `Registro ${kind}`, { scope: "company", body: `corpo ${kind}` }),
    );
    assert.equal(rec.schema_version, "control-center.directive.v1");
    assert.equal(rec.kind, kind);
    assert.equal(rec.scope, "company");
    assert.equal(rec.status, "active");
    assert.ok(rec.effective_from.endsWith("Z"));
    assert.equal(rec.expires_at, null);
    assert.equal(rec.supersedes, null);
    assert.equal(rec.created_by.id, "human:founder");
    assert.ok(rec.audit.length >= 1);
    assert.equal(rec.audit[0]?.action, "created");
    assert.match(rec.id, /^cc:directive:/);
    assert.equal(session.service.get(rec.id)?.kind, kind);
  }
});

test("create refuses an unconfirmed kind", () => {
  const session = makeSession();
  assert.throws(
    () => session.service.create(createInput("decision", "Ops", { kindConfirm: "fact" })),
    (error: unknown) => isDirectiveUiError(error) && error.code === "kind_mismatch",
  );
});

test("create refuses a missing kind confirmation from the draft", () => {
  const session = makeSession();
  const draft = session.service.newDraft();
  draft.kind = "decision";
  draft.kindConfirmed = false;
  draft.title = "Uma decisão";
  draft.body = "Texto da decisão";
  assert.throws(
    () => draftToInput(draft),
    (error: unknown) => isDirectiveUiError(error) && error.code === "kind_not_confirmed",
  );
});

test("saving a decision requires confirming decision; saving a fact is a different explicit choice", () => {
  const session = makeSession();
  assert.throws(() =>
    session.service.create({
      ...createInput("decision", "Não é fato"),
      kindConfirm: "fact",
    }),
  );
  const decision = session.service.create({
    ...createInput("decision", "Esta é a decisão"),
    kindConfirm: "decision",
  });
  assert.equal(decision.kind, "decision");
  const fact = session.service.create({
    ...createInput("fact", "Este é o fato", { scope: "commercial" }),
    kindConfirm: "fact",
  });
  assert.equal(fact.kind, "fact");
  assert.notEqual(decision.kind, fact.kind);
});

test("new drafts fill scope, status, UTC effective_from and empty expiration", () => {
  const session = makeSession();
  const draft = session.service.newDraft();
  assert.equal(draft.kind, "");
  assert.equal(draft.kindConfirmed, false);
  assert.equal(draft.scope, "company");
  assert.equal(draft.status, "active");
  assert.equal(draft.effective_from, "2026-08-20T15:00:00Z");
  assert.equal(draft.expires_at, "");
  assert.equal(draft.title, "");
  assert.equal(draft.body, "");
  const impact = draftImpact(draft);
  assert.match(impact.scopeSummary, /company/i);
  assert.match(impact.expirationSummary, /Sem expiração/);
});

test("mutate is fail-closed when identity is not founder", () => {
  const session = makeSession({
    CONTROL_CENTER_FOUNDER_ACTOR_ID: "human:founder",
    CC_ACTOR_ID: "agent:cc-context",
    CC_ACTOR_ROLE: "agent",
    CC_USE_MOCK_IDENTITY: "0",
  });
  assert.throws(
    () => session.service.create(createInput("risk", "Não deve gravar")),
    (error: unknown) => isDirectiveUiError(error) && error.code === "not_founder",
  );
});
