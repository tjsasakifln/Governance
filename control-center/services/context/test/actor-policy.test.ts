import assert from "node:assert/strict";
import { test } from "node:test";
import { ServiceError, parseActor } from "../src/index.ts";
import { AGENT, FOUNDER, createInput, makeService } from "./helpers.ts";

test("missing or unknown actor identity is rejected fail-closed", () => {
  assert.throws(() => parseActor(undefined, "human"), (err: unknown) => {
    return err instanceof ServiceError && err.code === "missing_actor" && err.httpStatus === 401;
  });
  assert.throws(() => parseActor("founder-test", undefined), (err: unknown) => {
    return err instanceof ServiceError && err.code === "missing_actor";
  });
  assert.throws(() => parseActor("founder-test", "admin"), (err: unknown) => {
    return err instanceof ServiceError && err.code === "unknown_actor_role";
  });
  assert.throws(() => parseActor("founder-test", "founder"), (err: unknown) => {
    return err instanceof ServiceError && err.code === "unknown_actor_role";
  });
  assert.throws(() => parseActor("user@example.com", "human"), (err: unknown) => {
    return err instanceof ServiceError && err.code === "invalid_actor_id";
  });
  const { service } = makeService();
  assert.throws(
    () => service.createDirective({ id: "someone-else", kind: "human" }, createInput("fact", "Nope")),
    (err: unknown) => err instanceof ServiceError && err.code === "unknown_actor" && err.httpStatus === 401,
  );
});

test("agent cannot mutate directives", () => {
  const { service } = makeService();
  const rec = service.createDirective(FOUNDER, createInput("constraint", "Do not ship Extra"));
  const attempts: Array<() => void> = [
    () => service.createDirective(AGENT, createInput("fact", "Agent fact")),
    () => service.createVersion(AGENT, rec.id, { title: "silent rewrite" }),
    () => service.expire(AGENT, rec.id),
    () => service.revoke(AGENT, rec.id),
    () =>
      service.supersede(
        AGENT,
        rec.id,
        createInput("constraint", "Replacement", { body: "agent replacement" }),
      ),
    () => service.activate(AGENT, rec.id),
  ];
  for (const attempt of attempts) {
    assert.throws(
      attempt,
      (err: unknown) =>
        err instanceof ServiceError && err.code === "agent_mutation_forbidden" && err.httpStatus === 403,
    );
  }
  const still = service.getDirective(FOUNDER, rec.id);
  assert.equal(still.title, "Do not ship Extra");
  assert.equal(still.version, 1);
  assert.equal(still.status, "active");
});

test("agent cannot silently replace an active constraint or decision; proposals do not change the active set", () => {
  const { service } = makeService();
  const constraint = service.createDirective(FOUNDER, createInput("constraint", "Keep Extra private"));
  const decision = service.createDirective(FOUNDER, createInput("decision", "Governance is authority"));
  const before = service.getActiveDirectives(FOUNDER, "company");
  const beforeContext = service.getContext(FOUNDER, "company");

  const proposal = service.submitProposal(AGENT, {
    action: "supersede",
    kind: "constraint",
    title: "Agent wants to replace constraint",
    body: "This must remain a suggestion.",
    scope: "company",
    target_directive_id: constraint.id,
    rationale: "Agent suggestion only",
    source: { system: "collector", kind: "agent-report", locator: "session-1" },
    confidence: 0.5,
  });
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.action, "supersede");
  assert.equal(proposal.created_by.kind, "agent");

  service.submitProposal(AGENT, {
    action: "expire",
    kind: "decision",
    title: "Agent wants to expire a decision",
    body: "Must not apply.",
    scope: "company",
    target_directive_id: decision.id,
    rationale: "Suggestion",
    source: { system: "collector", kind: "agent-report", locator: "session-1" },
    confidence: 0.5,
  });

  const after = service.getActiveDirectives(FOUNDER, "company");
  assert.deepEqual(
    after.map((d) => d.revision_id),
    before.map((d) => d.revision_id),
  );
  assert.equal(service.getDirective(FOUNDER, constraint.id).status, "active");
  assert.equal(service.getDirective(FOUNDER, decision.id).status, "active");
  const afterContext = service.getContext(FOUNDER, "company");
  assert.deepEqual(afterContext, beforeContext);
  const proposalAudits = service.listAudit(FOUNDER).filter((a) => a.action === "proposal.submit");
  assert.equal(proposalAudits.length, 2);
});

test("identity is injected, not hardcoded as a password", () => {
  const { service } = makeService();
  const rec = service.createDirective(FOUNDER, createInput("fact", "Injected founder"));
  assert.equal(rec.created_by.kind, "human");
  assert.equal(rec.created_by.id, "founder-test");
  assert.notEqual(rec.created_by.id, "password");
  assert.notEqual(FOUNDER.id, "admin");
});

test("system actor cannot mutate or submit proposals", () => {
  const { service } = makeService();
  const rec = service.createDirective(FOUNDER, createInput("decision", "Locked"));
  const system = { kind: "system" as const, id: "cc-context" };
  assert.throws(
    () => service.createDirective(system, createInput("fact", "nope")),
    (err: unknown) => err instanceof ServiceError && err.code === "agent_mutation_forbidden",
  );
  assert.throws(
    () =>
      service.submitProposal(system, {
        action: "create",
        kind: "fact",
        title: "system proposal",
        body: "nope",
        scope: "company",
        rationale: "nope",
        source: { system: "collector", kind: "system", locator: "x" },
        confidence: 1,
      }),
    (err: unknown) => err instanceof ServiceError && err.code === "agent_mutation_forbidden",
  );
  assert.equal(service.getDirective(system, rec.id).id, rec.id);
});
