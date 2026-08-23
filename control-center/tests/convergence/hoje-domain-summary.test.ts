/**
 * Issue #61 — per-domain panorama on Hoje, asserted across the real seam.
 *
 * Nothing here is stubbed between the service and the screen: the real
 * `createOperationalService` answers a real HTTP request, the response is
 * validated against the published `operational-envelope.v1` schema, and the
 * real `createHttpAdapter` + `renderHoje` turn that exact body into the HTML an
 * operator sees. The expected card states are recomputed from the live body
 * rather than hard-coded, so the test cannot pass by agreeing with a fixture
 * that production never emits.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { validateOperationalEnvelope } from "../../contracts/src/operational-envelope.ts";
import { createHttpAdapter } from "../../apps/web-shell/src/adapters/index.ts";
import { OPERATIONAL_ENVELOPE_FIXTURE } from "../../apps/web-shell/src/fixtures/operational-envelope.ts";
import {
  assertNoHealthyOnUntrusted,
  summarizeDomains,
} from "../../apps/web-shell/src/hoje-domains.ts";
import { renderHoje } from "../../apps/web-shell/src/ui/hoje.ts";
import { frozenClock } from "../../services/context/src/clock.ts";
import { createRequestListener } from "../../services/context/src/http.ts";
import { silentLogger } from "../../services/context/src/log.ts";
import { createFixtureStore } from "../../services/context/src/store/fixture.ts";
import { createFixtureOperationalPort } from "../../services/context/src/operational/fixture.ts";
import {
  OPERATIONAL_NOW,
  representativeOperationalData,
} from "../../services/context/src/operational/representative.ts";
import { createOperationalService } from "../../services/context/src/operational/service.ts";
import { createContextService } from "../../services/context/src/service.ts";
import { sequentialIds } from "../../services/context/src/ids.ts";
import { REPRESENTATIVE_REPO_DOMAINS } from "../../services/context/src/representative.ts";

const FOUNDER = { id: "founder-test", kind: "human" } as const;

async function withRealBackend(fn: (base: string) => Promise<void>): Promise<void> {
  const store = createFixtureStore();
  const service = createContextService({
    store,
    clock: frozenClock(OPERATIONAL_NOW),
    ids: sequentialIds("id"),
    founderActorId: FOUNDER.id,
    logger: silentLogger,
    defaultScope: "company",
    repoDomains: REPRESENTATIVE_REPO_DOMAINS,
  });
  const operational = createOperationalService({
    port: createFixtureOperationalPort(structuredClone(representativeOperationalData())),
    clock: frozenClock(OPERATIONAL_NOW),
    founderActorId: FOUNDER.id,
    repoDomains: REPRESENTATIVE_REPO_DOMAINS,
  });
  const server = createServer(createRequestListener({ service, operational, logger: silentLogger }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test("the shipped mock envelope validates against the same schema as the live response", () => {
  const result = validateOperationalEnvelope(OPERATIONAL_ENVELOPE_FIXTURE);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.schema_version, "control-center.operational-envelope.v1");
});

test("the live GET /v1/operational-snapshots body is what the panorama is built from", async () => {
  await withRealBackend(async (base) => {
    const response = await fetch(`${base}/v1/operational-snapshots?scope=company`, {
      headers: { "x-actor-id": FOUNDER.id, "x-actor-kind": FOUNDER.kind },
    });
    assert.equal(response.status, 200);
    const live = (await response.json()) as Record<string, unknown>;
    const validation = validateOperationalEnvelope(live);
    assert.deepEqual(validation.errors, []);

    const summary = summarizeDomains(live);
    assert.equal(summary.envelope_present, true);
    assert.equal(summary.cards.length, 6);
    assertNoHealthyOnUntrusted(summary);

    // Expectations recomputed from the live body, never hard-coded.
    const slots = live.snapshots as Record<string, Record<string, unknown> | null>;
    const byDomain: Record<string, string> = {
      comercial: "commercial",
      clientes: "clients",
      financeiro: "finance",
      engenharia: "engineering",
      infra: "infrastructure",
    };
    for (const card of summary.cards) {
      const domain = byDomain[card.id];
      if (domain === undefined) continue;
      const slot = slots[domain];
      assert.ok(slot, `live envelope has no ${domain} slot`);
      assert.equal(card.presence, slot.presence);
      assert.equal(card.freshness_status, slot.freshness_status);
      assert.equal(card.observed_at, slot.observed_at);
      if (slot.presence === "absent") {
        assert.equal(card.absence_reason, slot.absence_reason);
        assert.notEqual(card.state, "saudavel");
        assert.match(card.state_reason, /Faltam dados|Erro de coleta/);
      }
      if (slot.freshness_status !== "FRESH") {
        assert.notEqual(card.state, "saudavel");
      }
    }
  });
});

test("the live envelope reaches the rendered Hoje page as domain cards, a total and slice links", async () => {
  await withRealBackend(async (base) => {
    const adapter = createHttpAdapter(base, fetch, { kind: "human", id: FOUNDER.id });
    const result = await adapter.readDestination("hoje");
    assert.equal(result.ok, true, `adapter failed: ${JSON.stringify(result).slice(0, 400)}`);
    assert.ok(result.ok && result.page.hoje, "Hoje view model missing");
    const view = result.page.hoje;
    const domains = view.sections.find((section) => section.id === "domains");
    assert.ok(domains, "panorama section missing from the composed view");
    assert.ok(domains.summary, "panorama section carries no summary");
    assert.equal(domains.summary.envelope_present, true);

    const html = renderHoje(view);
    for (const id of ["comercial", "clientes", "financeiro", "engenharia", "infra", "warmbly"]) {
      assert.match(html, new RegExp(`data-domain-card="${id}"`), `card ${id} not rendered`);
    }
    assert.match(html, /data-action-total="\d+"/);
    assert.match(html, /data-outbound-state="(ACTIVE|PAUSED|UNKNOWN)"/);
    assert.match(html, /href="#\/comercial"/);
    assert.match(html, /href="#\/infra"/);
    assert.match(html, /última atualização/);
    // "ignorar" was the empty state the issue rejects; it must be gone from the
    // whole page, not just from the new section.
    assert.doesNotMatch(html, /ignorar/);
  });
});

test("a backend that answers with a non-envelope body yields desconhecido, never six healthy cards", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ items: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const adapter = createHttpAdapter(`http://127.0.0.1:${address.port}`, fetch, {
      kind: "human",
      id: FOUNDER.id,
    });
    const result = await adapter.readDestination("hoje");
    assert.equal(result.ok, true);
    assert.ok(result.ok && result.page.hoje);
    const summary = result.page.hoje.sections.find((s) => s.id === "domains")?.summary;
    assert.ok(summary);
    assert.equal(summary.envelope_present, false);
    for (const card of summary.cards) {
      assert.equal(card.state, "desconhecido");
    }
    const html = renderHoje(result.page.hoje);
    assert.doesNotMatch(html, /data-domain-state="saudavel"/);
    assert.match(html, /Faltam dados/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});
