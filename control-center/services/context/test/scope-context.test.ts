import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalStringify } from "../src/index.ts";
import { AGENT, FOUNDER, createInput, makeService } from "./helpers.ts";

const RESOURCE = {
  company: "confenge",
  domain: "commercial",
  resource: "offer:CFG-DIAG-EXP-v1",
};
const SIBLING = {
  company: "confenge",
  domain: "commercial",
  resource: "offer:OTHER-SKU",
};
const DOMAIN = { company: "confenge", domain: "commercial" };
const COMPANY = { company: "confenge" };

test("scope inheritance is company + domain + resource and does not leak siblings or descendants", () => {
  const { service } = makeService();
  const company = service.createDirective(FOUNDER, createInput("priority", "Company priority", { scope: COMPANY }));
  const domain = service.createDirective(FOUNDER, createInput("directive", "Domain directive", { scope: DOMAIN }));
  const resource = service.createDirective(FOUNDER, createInput("fact", "Resource fact", { scope: RESOURCE }));
  const sibling = service.createDirective(FOUNDER, createInput("fact", "Sibling fact", { scope: SIBLING }));
  const otherDomain = service.createDirective(
    FOUNDER,
    createInput("risk", "Finance risk", { scope: { company: "confenge", domain: "finance" } }),
  );

  const ctx = service.getContext(FOUNDER, RESOURCE);
  const ids = ctx.active_directives.map((d) => d.id);
  assert.ok(ids.includes(company.id));
  assert.ok(ids.includes(domain.id));
  assert.ok(ids.includes(resource.id));
  assert.equal(ids.includes(sibling.id), false);
  assert.equal(ids.includes(otherDomain.id), false);

  const companyCtx = service.getContext(FOUNDER, COMPANY);
  const companyIds = companyCtx.active_directives.map((d) => d.id);
  assert.ok(companyIds.includes(company.id));
  assert.equal(companyIds.includes(domain.id), false);
  assert.equal(companyIds.includes(resource.id), false);
  assert.equal(companyIds.includes(sibling.id), false);

  const siblingCtx = service.getContext(AGENT, SIBLING);
  assert.ok(siblingCtx.active_directives.some((d) => d.id === sibling.id));
  assert.equal(
    siblingCtx.active_directives.some((d) => d.id === resource.id),
    false,
  );
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

  const ctx1 = service.getContext(FOUNDER, COMPANY);
  const ctx2 = service.getContext(FOUNDER, COMPANY);
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
    assert.equal(typeof item.source, "string");
    assert.ok(item.observed_at.endsWith("Z"));
    assert.ok(item.freshness_status === "fresh" || item.freshness_status === "stale" || item.freshness_status === "unknown");
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

  const ctx = service.getContext(FOUNDER, COMPANY);
  const ids = ctx.active_directives.map((d) => d.id);
  assert.ok(ids.includes(live.id));
  assert.ok(ids.includes(successor.id));
  assert.equal(ids.includes(expiring.id), false);
  assert.equal(ids.includes(old.id), false);
  assert.equal(service.getDirective(FOUNDER, expiring.id).status, "expired");
  assert.equal(service.getDirective(FOUNDER, old.id).status, "superseded");
  assert.ok(service.listRevisions(FOUNDER, old.id).length >= 2);
});
