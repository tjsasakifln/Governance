import assert from "node:assert/strict";
import { test } from "node:test";
import { ServiceError } from "../src/index.ts";
import { AGENT, FOUNDER, createInput, makeService } from "./helpers.ts";

test("adversarial: scope leak across repo, client, domain, and company dump", () => {
  const { service } = makeService();
  const company = service.createDirective(FOUNDER, createInput("priority", "Company", { scope: "company" }));
  const commercial = service.createDirective(FOUNDER, createInput("directive", "Commercial", { scope: "commercial" }));
  const finance = service.createDirective(FOUNDER, createInput("risk", "Finance", { scope: "finance" }));
  const gov = service.createDirective(FOUNDER, createInput("fact", "Gov repo", { scope: "repo:Governance" }));
  const warmbly = service.createDirective(FOUNDER, createInput("fact", "Warmbly repo", { scope: "repo:Warmbly" }));
  const clients = service.createDirective(FOUNDER, createInput("directive", "Clients", { scope: "clients" }));
  const acme = service.createDirective(FOUNDER, createInput("fact", "Acme", { scope: "client:acme" }));
  const other = service.createDirective(FOUNDER, createInput("fact", "Other", { scope: "client:other" }));

  const repoIds = service.getContext(FOUNDER, "repo:Governance").active_directives.map((d) => d.id);
  assert.deepEqual(
    new Set(repoIds),
    new Set([company.id, commercial.id, gov.id]),
  );

  const clientIds = service.getContext(FOUNDER, "client:acme").active_directives.map((d) => d.id);
  assert.deepEqual(
    new Set(clientIds),
    new Set([company.id, clients.id, acme.id]),
  );

  const companyIds = service.getContext(FOUNDER, "company").active_directives.map((d) => d.id);
  assert.deepEqual(companyIds, [company.id]);

  const commercialIds = service.getContext(FOUNDER, "commercial").active_directives.map((d) => d.id);
  assert.equal(commercialIds.includes(gov.id), false);
  assert.equal(commercialIds.includes(warmbly.id), false);
  assert.equal(commercialIds.includes(finance.id), false);
  assert.equal(commercialIds.includes(acme.id), false);
  assert.ok(commercialIds.includes(company.id));
  assert.ok(commercialIds.includes(commercial.id));

  assert.equal(clientIds.includes(other.id), false);
  assert.equal(repoIds.includes(warmbly.id), false);
});

test("adversarial: agent overwrite of decision and constraint is denied and leaves the active set unchanged", () => {
  const { service } = makeService();
  const decision = service.createDirective(FOUNDER, createInput("decision", "Canonical decision"));
  const constraint = service.createDirective(FOUNDER, createInput("constraint", "Canonical constraint"));
  const before = service.getContext(FOUNDER, "company");

  for (const target of [decision, constraint]) {
    assert.throws(
      () => service.createVersion(AGENT, target.id, { body: "overwrite" }),
      (err: unknown) => err instanceof ServiceError && err.code === "agent_mutation_forbidden",
    );
    assert.throws(
      () => service.supersede(AGENT, target.id, createInput(target.kind, "Replacement")),
      (err: unknown) => err instanceof ServiceError && err.code === "agent_mutation_forbidden",
    );
    assert.throws(
      () => service.revoke(AGENT, target.id),
      (err: unknown) => err instanceof ServiceError && err.code === "agent_mutation_forbidden",
    );
    assert.throws(
      () => service.expire(AGENT, target.id),
      (err: unknown) => err instanceof ServiceError && err.code === "agent_mutation_forbidden",
    );
    const proposal = service.submitProposal(AGENT, {
      action: "supersede",
      kind: target.kind,
      title: "Agent replacement",
      body: "Must not apply.",
      scope: "company",
      target_directive_id: target.id,
      rationale: "report only",
      source: { system: "collector", kind: "agent-report", locator: "adv" },
      confidence: 0.1,
    });
    assert.equal(proposal.status, "pending");
  }

  const after = service.getContext(FOUNDER, "company");
  assert.deepEqual(after, before);
  assert.equal(service.getDirective(FOUNDER, decision.id).status, "active");
  assert.equal(service.getDirective(FOUNDER, constraint.id).status, "active");
  assert.equal(service.getDirective(FOUNDER, decision.id).body, "Canonical decision body");
});

test("adversarial: multi-supersede, revoke, expire drop from the active set but remain readable", () => {
  const { service } = makeService();
  const a = service.createDirective(FOUNDER, createInput("constraint", "A"));
  const b = service.createDirective(FOUNDER, createInput("constraint", "B"));
  const toRevoke = service.createDirective(FOUNDER, createInput("directive", "Revoke me"));
  const toExpire = service.createDirective(FOUNDER, createInput("risk", "Expire me"));

  const successor = service.supersede(
    FOUNDER,
    a.id,
    createInput("constraint", "Merged", { supersedes: [b.id] }),
  );
  assert.deepEqual(successor.supersedes, [a.id, b.id]);
  service.revoke(FOUNDER, toRevoke.id);
  service.expire(FOUNDER, toExpire.id);

  const activeIds = service.getActiveDirectives(FOUNDER, "company").map((d) => d.id);
  assert.equal(activeIds.includes(a.id), false);
  assert.equal(activeIds.includes(b.id), false);
  assert.equal(activeIds.includes(toRevoke.id), false);
  assert.equal(activeIds.includes(toExpire.id), false);
  assert.ok(activeIds.includes(successor.id));

  assert.equal(service.getDirective(FOUNDER, a.id).status, "superseded");
  assert.equal(service.getDirective(FOUNDER, b.id).status, "superseded");
  assert.equal(service.getDirective(FOUNDER, toRevoke.id).status, "revoked");
  assert.equal(service.getDirective(FOUNDER, toExpire.id).status, "expired");
});

test("adversarial: ERROR freshness is stored and returned as ERROR, never UNKNOWN", () => {
  const { service } = makeService();
  const rec = service.createDirective(
    FOUNDER,
    createInput("fact", "Broken collector", {
      freshness_status: "ERROR",
      confidence: 0.15,
      source: { system: "warmbly", kind: "snapshot", locator: "fail-1" },
    }),
  );
  assert.equal(rec.provenance.freshness_status, "ERROR");
  const loaded = service.getDirective(FOUNDER, rec.id);
  assert.equal(loaded.provenance.freshness_status, "ERROR");
  const view = service.getContext(FOUNDER, "company").active_directives.find((d) => d.id === rec.id);
  assert.ok(view);
  assert.equal(view.freshness_status, "ERROR");
  assert.notEqual(view.freshness_status, "UNKNOWN");
  assert.equal(view.confidence, 0.15);

  const versioned = service.createVersion(FOUNDER, rec.id, { freshness_status: "ERROR", title: "Still broken" });
  assert.equal(versioned.provenance.freshness_status, "ERROR");
  assert.equal(service.getDirective(FOUNDER, rec.id).provenance.freshness_status, "ERROR");
});
