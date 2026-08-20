import assert from "node:assert/strict";
import { test } from "node:test";
import { DIRECTIVE_KINDS, isActiveAt, frozenClock } from "../src/index.ts";
import { NOW, FOUNDER, createInput, makeService } from "./helpers.ts";

test("creates all seven kinds with required fields and one audit per create", () => {
  const { service } = makeService();
  for (const kind of DIRECTIVE_KINDS) {
    const rec = service.createDirective(
      FOUNDER,
      createInput(kind, `Kind ${kind}`, { confidence: kind === "hypothesis" ? 0.3 : 1 }),
    );
    assert.equal(rec.kind, kind);
    assert.equal(rec.status, "active");
    assert.equal(rec.scope, "company");
    assert.match(rec.id, /^cc:directive:/);
    assert.match(rec.revision_id, /^cc:directive-revision:/);
    assert.ok(rec.effective_from.endsWith("Z"));
    assert.equal(rec.expires_at, null);
    assert.equal(rec.supersedes, null);
    assert.equal(rec.created_by.kind, "human");
    assert.equal(rec.created_by.id, FOUNDER.id);
    assert.equal(rec.created_at, NOW);
    assert.equal(rec.provenance.source.system, "manual");
    assert.ok(rec.provenance.observed_at.endsWith("Z"));
    assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(rec.provenance.freshness_status));
    assert.equal(typeof rec.provenance.confidence, "number");
  }
  const audits = service.listAudit(FOUNDER);
  assert.equal(audits.length, DIRECTIVE_KINDS.length);
  assert.ok(audits.every((a) => a.action === "directive.create"));
  assert.ok(audits.every((a) => a.at.endsWith("Z")));
  assert.ok(audits.every((a) => a.actor.kind === "human"));
});

test("versioning is non-destructive and audited", () => {
  const { service } = makeService();
  const created = service.createDirective(FOUNDER, createInput("directive", "V1 title"));
  const v2 = service.createVersion(FOUNDER, created.id, { title: "V2 title", body: "V2 body" });
  assert.equal(v2.id, created.id);
  assert.equal(v2.version, 2);
  assert.notEqual(v2.revision_id, created.revision_id);
  assert.equal(v2.title, "V2 title");
  const current = service.getDirective(FOUNDER, created.id);
  assert.equal(current.revision_id, v2.revision_id);
  const revs = service.listRevisions(FOUNDER, created.id);
  assert.equal(revs.length, 2);
  assert.equal(revs[0]?.title, "V1 title");
  assert.equal(revs[1]?.title, "V2 title");
  const actions = service.listAudit(FOUNDER).map((a) => a.action);
  assert.deepEqual(actions, ["directive.create", "directive.version"]);
});

test("supersede closes the predecessor and creates a successor", () => {
  const { service } = makeService();
  const original = service.createDirective(FOUNDER, createInput("constraint", "Old constraint"));
  const successor = service.supersede(
    FOUNDER,
    original.id,
    createInput("constraint", "New constraint", { body: "Replacement text" }),
  );
  assert.deepEqual(successor.supersedes, [original.id]);
  assert.equal(successor.status, "active");
  const closed = service.getDirective(FOUNDER, original.id);
  assert.equal(closed.status, "superseded");
  const now = frozenClock(NOW).now();
  assert.equal(isActiveAt(closed, now), false);
  assert.equal(isActiveAt(successor, now), true);
  const history = service.listRevisions(FOUNDER, original.id);
  assert.ok(history.length >= 2);
  assert.ok(history.some((r) => r.status === "active"));
  assert.ok(history.some((r) => r.status === "superseded"));
  const active = service.getActiveDirectives(FOUNDER, "company");
  assert.ok(active.every((d) => d.id !== original.id));
  assert.ok(active.some((d) => d.id === successor.id));
  const actions = service.listAudit(FOUNDER).map((a) => a.action);
  assert.deepEqual(actions, ["directive.create", "directive.supersede", "directive.create"]);
});

test("one successor can supersede multiple canonical predecessors", () => {
  const { service } = makeService();
  const a = service.createDirective(FOUNDER, createInput("constraint", "Constraint A"));
  const b = service.createDirective(FOUNDER, createInput("constraint", "Constraint B"));
  const successor = service.createDirective(
    FOUNDER,
    createInput("constraint", "Merged constraint", { supersedes: [a.id, b.id] }),
  );
  assert.deepEqual(successor.supersedes, [a.id, b.id]);
  assert.equal(service.getDirective(FOUNDER, a.id).status, "superseded");
  assert.equal(service.getDirective(FOUNDER, b.id).status, "superseded");
  const active = service.getActiveDirectives(FOUNDER, "company");
  assert.equal(active.some((d) => d.id === a.id), false);
  assert.equal(active.some((d) => d.id === b.id), false);
  assert.ok(active.some((d) => d.id === successor.id));
  assert.ok(service.getDirective(FOUNDER, a.id).id, a.id);
  assert.ok(service.listRevisions(FOUNDER, a.id).length >= 2);
});

test("expire removes from active set and keeps history", () => {
  const { service } = makeService();
  const rec = service.createDirective(FOUNDER, createInput("risk", "A risk"));
  const expired = service.expire(FOUNDER, rec.id);
  assert.equal(expired.status, "expired");
  assert.equal(expired.expires_at, NOW);
  const active = service.getActiveDirectives(FOUNDER, "company");
  assert.ok(active.every((d) => d.id !== rec.id));
  const history = service.listRevisions(FOUNDER, rec.id);
  assert.equal(history.length, 2);
  assert.equal(service.listAudit(FOUNDER).filter((a) => a.action === "directive.expire").length, 1);
  assert.equal(service.getDirective(FOUNDER, rec.id).status, "expired");
});

test("draft then activate then revoke toggles membership of the active set", () => {
  const { service } = makeService();
  const rec = service.createDirective(FOUNDER, createInput("directive", "Draft", { status: "draft" }));
  assert.equal(rec.status, "draft");
  assert.equal(
    service.getActiveDirectives(FOUNDER, "company").some((d) => d.id === rec.id),
    false,
  );
  const activated = service.activate(FOUNDER, rec.id);
  assert.equal(activated.status, "active");
  assert.ok(service.getActiveDirectives(FOUNDER, "company").some((d) => d.id === rec.id));
  const revoked = service.revoke(FOUNDER, rec.id);
  assert.equal(revoked.status, "revoked");
  assert.equal(
    service.getActiveDirectives(FOUNDER, "company").some((d) => d.id === rec.id),
    false,
  );
  assert.equal(service.getDirective(FOUNDER, rec.id).status, "revoked");
  const actions = service.listAudit(FOUNDER).map((a) => a.action);
  assert.deepEqual(actions, ["directive.create", "directive.activate", "directive.revoke"]);
});

test("items past expires_at are absent from the active set even if status is still active", () => {
  const { service } = makeService();
  const rec = service.createDirective(
    FOUNDER,
    createInput("directive", "Time boxed", {
      effective_from: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-01-02T00:00:00.000Z",
    }),
  );
  assert.equal(rec.status, "active");
  const active = service.getActiveDirectives(FOUNDER, "company");
  assert.ok(active.every((d) => d.id !== rec.id));
  assert.equal(service.getDirective(FOUNDER, rec.id).id, rec.id);
});
