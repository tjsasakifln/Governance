import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { packageRoot } from "../src/paths.js";

test("runtime identity is a read-only full-SHA HTTP contract", () => {
  const document = JSON.parse(
    readFileSync(path.join(packageRoot(), "docs/http.openapi.json"), "utf8"),
  ) as {
    paths: Record<string, Record<string, unknown>>;
    components: { schemas: { RuntimeIdentity: { properties: Record<string, Record<string, unknown>> } } };
  };
  const route = document.paths["/v1/runtime-identity"];
  assert.ok(route);
  assert.deepEqual(Object.keys(route), ["get"]);
  const schema = document.components.schemas.RuntimeIdentity;
  assert.equal(schema.properties.schema_version?.const, "control-center.runtime-identity.v1");
  assert.equal(schema.properties.required_baseline_sha?.const, "64ece7d38abacd3adeaa02735b4f22af66caab0f");
  assert.deepEqual(schema.properties.release_status?.enum, ["PINNED", "UNVERIFIED"]);
  const releaseSha = schema.properties.release_sha as { oneOf: Array<{ pattern?: string }> };
  assert.equal(releaseSha.oneOf[0]?.pattern, "^[0-9a-f]{40}$");
});
