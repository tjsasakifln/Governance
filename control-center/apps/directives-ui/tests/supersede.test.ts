import assert from "node:assert/strict";
import { test } from "node:test";
import { createInput, makeSession } from "./helpers.ts";

test("supersede leaves the predecessor readable as superseded and does not rewrite body or kind", () => {
  const session = makeSession();
  const original = session.service.create(
    createInput("decision", "Decisão v1", { body: "Texto original da decisão." }),
  );
  const originalBody = original.body;
  const originalKind = original.kind;

  const result = session.service.supersede(
    original.id,
    createInput("decision", "Decisão v2", { body: "Texto sucessor." }),
  );

  assert.equal(result.predecessor.id, original.id);
  assert.equal(result.predecessor.status, "superseded");
  assert.equal(result.predecessor.body, originalBody);
  assert.equal(result.predecessor.kind, originalKind);
  assert.equal(result.predecessor.title, "Decisão v1");
  assert.ok(result.predecessor.audit.some((entry) => entry.action === "superseded"));

  assert.notEqual(result.successor.id, original.id);
  assert.equal(result.successor.status, "active");
  assert.ok(result.successor.supersedes?.includes(original.id));
  assert.equal(result.successor.body, "Texto sucessor.");

  const storedOld = session.service.get(original.id);
  assert.equal(storedOld?.status, "superseded");
  assert.equal(storedOld?.body, originalBody);
  assert.equal(storedOld?.kind, originalKind);

  const storedNew = session.service.get(result.successor.id);
  assert.equal(storedNew?.supersedes?.[0], original.id);

  const listedOld = session.service.list({
    query: "",
    kind: "all",
    scope: "all",
    status: "superseded",
  });
  assert.ok(listedOld.some((row) => row.id === original.id));
});

test("fixture predecessor remains readable after the seeded supersede", () => {
  const session = makeSession();
  const old = session.service.get("cc:directive:01K3CC-GOV-CANONICAL-OLD");
  const current = session.service.get("cc:directive:01K3CC-GOV-CANONICAL");
  assert.equal(old?.status, "superseded");
  assert.equal(old?.kind, "decision");
  assert.match(old?.body ?? "", /Earlier unresolved/);
  assert.ok(current?.supersedes?.includes("cc:directive:01K3CC-GOV-CANONICAL-OLD"));
});
