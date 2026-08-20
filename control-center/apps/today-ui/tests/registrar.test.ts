import assert from "node:assert/strict";
import { test } from "node:test";
import { recordIntent } from "../src/registrar.js";

test("recordIntent is local-only and does not mutate external systems", () => {
  const receipt = recordIntent(
    "decision",
    { title: "Pausar inbound até o recorte voltar", body: "nota local" },
    () => "2026-08-20T18:30:00Z",
  );
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.persisted, false);
  assert.equal(receipt.mutates_external, false);
  assert.equal(receipt.target, "local-intent");
  assert.equal(receipt.kind, "decision");
  assert.equal(receipt.recorded_at, "2026-08-20T18:30:00Z");
});

test("recordIntent rejects empty title and non-UTC clocks", () => {
  assert.throws(() =>
    recordIntent("nota", { title: "  ", body: "x" }, () => "2026-08-20T18:30:00Z"),
  );
  assert.throws(() =>
    recordIntent("nota", { title: "ok", body: "x" }, () => "2026-08-20T18:30:00-03:00"),
  );
});
