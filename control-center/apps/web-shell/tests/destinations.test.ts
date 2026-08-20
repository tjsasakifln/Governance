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

test("registry exposes the eight product destinations with exact labels", () => {
  assert.deepEqual([...DESTINATION_IDS], [
    "hoje",
    "comercial",
    "clientes",
    "financeiro",
    "engenharia",
    "infra",
    "memoria",
    "agentes",
  ]);
  assert.deepEqual(destinationLabels(), [
    "Hoje",
    "Comercial",
    "Clientes",
    "Financeiro",
    "Engenharia",
    "Infra",
    "Memória/Decisões",
    "Agentes",
  ]);
  assert.equal(DESTINATIONS.length, 8);
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
  assert.deepEqual(parseHash(""), { destination: "hoje", view: null });
  assert.deepEqual(parseHash("#/financeiro?view=stale"), {
    destination: "financeiro",
    view: "stale",
  });
  assert.deepEqual(parseHash("#/nope"), { destination: "hoje", view: null });
  assert.equal(hashFor("agentes", "empty"), "#/agentes?view=empty");
  assert.equal(hashFor("hoje"), "#/hoje");
});
