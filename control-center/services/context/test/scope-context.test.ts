import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalStringify } from "../src/index.ts";
import { AGENT, FOUNDER, createInput, makeService } from "./helpers.ts";

test("repo query inherits company + configured domain + repo and does not leak siblings or descendants", () => {
  const { service } = makeService();
  const company = service.createDirective(FOUNDER, createInput("priority", "Company priority", { scope: "company" }));
  const domain = service.createDirective(FOUNDER, createInput("directive", "Domain directive", { scope: "commercial" }));
  const resource = service.createDirective(
    FOUNDER,
    createInput("fact", "Repo fact", { scope: "repo:Governance" }),
  );
  const sibling = service.createDirective(FOUNDER, createInput("fact", "Sibling fact", { scope: "repo:Warmbly" }));
  const otherDomain = service.createDirective(
    FOUNDER,
    createInput("risk", "Finance risk", { scope: "finance" }),
  );
  const client = service.createDirective(FOUNDER, createInput("fact", "Client fact", { scope: "client:acme" }));

  const ctx = service.getContext(FOUNDER, "repo:Governance");
  assert.equal(ctx.scope, "repo:Governance");
  const ids = ctx.active_directives.map((d) => d.id);
  assert.ok(ids.includes(company.id));
  assert.ok(ids.includes(domain.id));
  assert.ok(ids.includes(resource.id));
  assert.equal(ids.includes(sibling.id), false);
  assert.equal(ids.includes(otherDomain.id), false);
  assert.equal(ids.includes(client.id), false);

  const companyCtx = service.getContext(FOUNDER, "company");
  const companyIds = companyCtx.active_directives.map((d) => d.id);
  assert.ok(companyIds.includes(company.id));
  assert.equal(companyIds.includes(domain.id), false);
  assert.equal(companyIds.includes(resource.id), false);
  assert.equal(companyIds.includes(sibling.id), false);

  const siblingCtx = service.getContext(AGENT, "repo:Warmbly");
  assert.ok(siblingCtx.active_directives.some((d) => d.id === sibling.id));
  assert.equal(
    siblingCtx.active_directives.some((d) => d.id === resource.id),
    false,
  );
});

test("client query inherits company + clients + client and does not leak siblings", () => {
  const { service } = makeService();
  const company = service.createDirective(FOUNDER, createInput("decision", "Company decision", { scope: "company" }));
  const clients = service.createDirective(FOUNDER, createInput("directive", "Clients domain", { scope: "clients" }));
  const acme = service.createDirective(FOUNDER, createInput("fact", "Acme fact", { scope: "client:acme" }));
  const other = service.createDirective(FOUNDER, createInput("fact", "Other client", { scope: "client:other" }));
  const commercial = service.createDirective(FOUNDER, createInput("fact", "Commercial fact", { scope: "commercial" }));
  const repo = service.createDirective(FOUNDER, createInput("fact", "Repo fact", { scope: "repo:Governance" }));

  const ctx = service.getContext(FOUNDER, "client:acme");
  const ids = ctx.active_directives.map((d) => d.id);
  assert.ok(ids.includes(company.id));
  assert.ok(ids.includes(clients.id));
  assert.ok(ids.includes(acme.id));
  assert.equal(ids.includes(other.id), false);
  assert.equal(ids.includes(commercial.id), false);
  assert.equal(ids.includes(repo.id), false);

  const clientsOnly = service.getContext(FOUNDER, "clients");
  const clientsIds = clientsOnly.active_directives.map((d) => d.id);
  assert.ok(clientsIds.includes(company.id));
  assert.ok(clientsIds.includes(clients.id));
  assert.equal(clientsIds.includes(acme.id), false);
  assert.equal(clientsIds.includes(other.id), false);
});

test("hypothesis is separated from fact and decision; provenance is present; get_context is deterministic", () => {
  const { service } = makeService();
  service.createDirective(FOUNDER, createInput("decision", "A decision", { confidence: 1 }));
  service.createDirective(FOUNDER, createInput("fact", "A fact", { confidence: 0.9 }));
  service.createDirective(
    FOUNDER,
    createInput("hypothesis", "A hypothesis", { confidence: 0.2, body: "Not a fact." }),
  );
  service.createDirective(FOUNDER, createInput("priority", "A priority"));

  const ctx1 = service.getContext(FOUNDER, "company");
  const ctx2 = service.getContext(FOUNDER, "company");
  assert.equal(canonicalStringify(ctx1), canonicalStringify(ctx2));

  assert.ok(ctx1.hypotheses.length === 1);
  assert.ok(ctx1.decisions.length === 1);
  assert.ok(ctx1.facts.length === 1);
  assert.equal(
    ctx1.decisions.some((d) => d.kind === "hypothesis"),
    false,
  );
  assert.equal(
    ctx1.facts.some((d) => d.kind === "hypothesis"),
    false,
  );
  assert.equal(ctx1.hypotheses[0]?.kind, "hypothesis");
  assert.equal(ctx1.decisions[0]?.kind, "decision");
  assert.equal(ctx1.facts[0]?.kind, "fact");

  for (const item of ctx1.active_directives) {
    assert.equal(typeof item.source, "object");
    assert.equal(typeof item.source.system, "string");
    assert.equal(typeof item.source.kind, "string");
    assert.equal(typeof item.source.locator, "string");
    assert.ok(item.observed_at.endsWith("Z"));
    assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(item.freshness_status));
    assert.equal(typeof item.confidence, "number");
    assert.equal(item.created_by.kind, "human");
  }
  assert.equal(ctx1.hypotheses[0]?.confidence, 0.2);

  const decisions = service.getDecisions(FOUNDER);
  assert.ok(decisions.every((d) => d.kind === "decision"));
  assert.equal(
    decisions.some((d) => d.kind === "hypothesis"),
    false,
  );
  const priorities = service.getPriorities(FOUNDER);
  assert.ok(priorities.every((d) => d.kind === "priority"));
  assert.ok(priorities.some((d) => d.title === "A priority"));
});

test("expired and superseded items stay out of get_context and remain readable as history", () => {
  const { service } = makeService();
  const live = service.createDirective(FOUNDER, createInput("fact", "Live fact"));
  const expiring = service.createDirective(FOUNDER, createInput("directive", "Will expire"));
  const old = service.createDirective(FOUNDER, createInput("constraint", "Old constraint"));
  service.expire(FOUNDER, expiring.id);
  const successor = service.supersede(FOUNDER, old.id, createInput("constraint", "New constraint"));

  const ctx = service.getContext(FOUNDER, "company");
  const ids = ctx.active_directives.map((d) => d.id);
  assert.ok(ids.includes(live.id));
  assert.ok(ids.includes(successor.id));
  assert.equal(ids.includes(expiring.id), false);
  assert.equal(ids.includes(old.id), false);
  assert.equal(service.getDirective(FOUNDER, expiring.id).status, "expired");
  assert.equal(service.getDirective(FOUNDER, old.id).status, "superseded");
  assert.ok(service.listRevisions(FOUNDER, old.id).length >= 2);
});
