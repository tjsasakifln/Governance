import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  classifyPath,
  healthPayload,
  inspectHealthBody,
  isPublicUnauthenticatedPath,
  validExampleDir,
} from "../src/index.js";
import path from "node:path";

describe("health allowlist and payload", () => {
  it("exposes only /healthz and /livez as public unauthenticated paths", () => {
    assert.equal(isPublicUnauthenticatedPath("/healthz"), true);
    assert.equal(isPublicUnauthenticatedPath("/livez"), true);
    assert.equal(isPublicUnauthenticatedPath("/healthz/"), true);
    assert.equal(classifyPath("/healthz?x=1"), "public_health");
    assert.equal(isPublicUnauthenticatedPath("/healthz/../admin"), false);
    assert.equal(isPublicUnauthenticatedPath("/api"), false);
    assert.equal(isPublicUnauthenticatedPath("/"), false);
    assert.equal(isPublicUnauthenticatedPath("/authelia"), false);
    assert.equal(classifyPath("/healthz/foo"), "protected");
  });

  it("ships a minimal liveness body with no state", () => {
    const payload = healthPayload();
    assert.deepEqual(payload, { status: "ok" });
    assert.deepEqual(Object.keys(payload), ["status"]);
    const inspection = inspectHealthBody(payload);
    assert.equal(inspection.ok, true);
    const committed = JSON.parse(
      readFileSync(path.join(validExampleDir(), "health-response.json"), "utf8"),
    ) as unknown;
    assert.deepEqual(committed, payload);
  });

  it("rejects health bodies that leak identity, secrets, or operational state", () => {
    const leak = inspectHealthBody({
      status: "ok",
      user: "operator",
      dsn: "postgres://authelia:hunter2@postgres:5432/authelia",
      redis: "up",
    });
    assert.equal(leak.ok, false);
    assert.ok(leak.leaks.some((item) => /user/i.test(item)));
    assert.ok(leak.leaks.some((item) => /dsn|secret|state/i.test(item)));
    assert.equal(inspectHealthBody({ status: "ok", db: "up" }).ok, false);
    assert.equal(inspectHealthBody({ status: "healthy" }).ok, false);
    assert.equal(inspectHealthBody(["ok"]).ok, false);
  });
});
