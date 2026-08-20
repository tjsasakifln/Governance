import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, ServiceError } from "../src/index.ts";
import { FOUNDER, createInput, makeService } from "./helpers.ts";

test("oversized and unsanitized inputs are rejected", () => {
  const { service } = makeService();
  assert.throws(
    () => service.createDirective(FOUNDER, createInput("fact", "x".repeat(LIMITS.titleChars + 1))),
    (err: unknown) => err instanceof ServiceError && err.code === "invalid_input",
  );
  assert.throws(
    () =>
      service.createDirective(
        FOUNDER,
        createInput("fact", "ok", { body: "b".repeat(LIMITS.bodyChars + 1) }),
      ),
    (err: unknown) => err instanceof ServiceError && err.code === "invalid_input",
  );
  assert.throws(
    () => service.createDirective(FOUNDER, { ...createInput("fact", "ok"), extra: true }),
    (err: unknown) => err instanceof ServiceError && err.code === "invalid_input",
  );
  assert.throws(
    () => service.createDirective(FOUNDER, createInput("fact", "   ")),
    (err: unknown) => err instanceof ServiceError && err.code === "invalid_input",
  );
  assert.throws(
    () =>
      service.createDirective(FOUNDER, {
        ...createInput("fact", "ok"),
        kind: "note",
      }),
    (err: unknown) => err instanceof ServiceError && err.code === "invalid_input",
  );
  assert.throws(
    () =>
      service.createDirective(FOUNDER, {
        ...createInput("fact", "ok"),
        created_by: "spoof",
      }),
    (err: unknown) => err instanceof ServiceError && err.code === "invalid_input",
  );
  assert.throws(
    () =>
      service.createDirective(
        FOUNDER,
        createInput("fact", "ok", { scope: { company: "confenge", resource: "no-domain" } }),
      ),
    (err: unknown) => err instanceof ServiceError && err.code === "invalid_input",
  );
  const created = service.createDirective(FOUNDER, createInput("fact", "Sanitized   title"));
  assert.equal(created.title, "Sanitized title");
  assert.equal(created.created_by, FOUNDER.id);
});

test("kind cannot change across versions", () => {
  const { service } = makeService();
  const rec = service.createDirective(FOUNDER, createInput("fact", "A fact"));
  assert.throws(
    () => service.createVersion(FOUNDER, rec.id, { kind: "hypothesis", title: "now a guess" }),
    (err: unknown) => err instanceof ServiceError && err.code === "invalid_input",
  );
});
