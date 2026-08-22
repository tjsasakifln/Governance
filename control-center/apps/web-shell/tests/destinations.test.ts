import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DESTINATION_IDS,
  DESTINATIONS,
  PRIMARY_SURFACE,
  destinationLabels,
  getDestination,
  hasChatDestination,
  hashFor,
  isDestinationId,
  parseHash,
} from "../src/destinations";

test("registry exposes the product destinations with exact labels", () => {
  assert.deepEqual([...DESTINATION_IDS], [
    "hoje",
    "comercial",
    "warmbly",
    "clientes",
    "financeiro",
    "engenharia",
    "infra",
    "crescimento",
    "memoria",
    "agentes",
  ]);
  assert.deepEqual(destinationLabels(), [
    "Hoje",
    "Comercial",
    "Operação Warmbly",
    "Clientes",
    "Financeiro",
    "Engenharia",
    "Infra",
    "Crescimento",
    "Memória/Decisões",
    "Agentes",
  ]);
  assert.equal(DESTINATIONS.length, 10);
  for (const id of DESTINATION_IDS) {
    const def = getDestination(id);
    assert.equal(def.id, id);
    assert.ok(def.path.startsWith("#/"));
    assert.ok(isDestinationId(id));
  }
});

test("there is no chat destination; primary surface is the attention cockpit", () => {
  assert.equal(hasChatDestination(), false);
  assert.equal(PRIMARY_SURFACE, "attention-cockpit");
});

test("parseHash maps unknown paths to Hoje and reads view overrides", () => {
  assert.deepEqual(parseHash(""), { destination: "hoje", view: null, surface: null, resource: null });
  assert.deepEqual(parseHash("#/financeiro?view=stale"), {
    destination: "financeiro",
    view: "stale",
    surface: null,
    resource: null,
  });
  assert.deepEqual(parseHash("#/nope"), { destination: "hoje", view: null, surface: null, resource: null });
  assert.deepEqual(parseHash("#/comercial/cohorts"), {
    destination: "comercial",
    view: null,
    surface: "cohorts",
    resource: null,
  });
  assert.deepEqual(parseHash("#/clientes/acme-industria"), {
    destination: "clientes",
    view: null,
    surface: null,
    resource: "acme-industria",
  });
  assert.deepEqual(parseHash("#/warmbly/operacao"), {
    destination: "warmbly",
    view: null,
    surface: "operacao",
    resource: null,
  });
  // An unknown sub-surface falls back to the route itself rather than 404ing a
  // sibling's not-yet-shipped surface into "hoje".
  assert.deepEqual(parseHash("#/warmbly/nao-existe"), {
    destination: "warmbly",
    view: null,
    surface: null,
    resource: null,
  });
  assert.equal(hashFor("warmbly", null, { surface: "operacao" }), "#/warmbly/operacao");
  assert.equal(hashFor("agentes", "empty"), "#/agentes?view=empty");
  assert.equal(hashFor("hoje"), "#/hoje");
});
