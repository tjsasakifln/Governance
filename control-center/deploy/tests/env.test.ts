import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ENV_EXAMPLE_REQUIRED_NAMES,
  assertEnvExampleSafe,
  looksLikeSecret,
} from "../src/env-file.ts";
import { ENV_EXAMPLE } from "../src/paths.ts";

test("shipped .env.example has required names and no high-entropy secrets", () => {
  const text = readFileSync(ENV_EXAMPLE, "utf8");
  const rows = assertEnvExampleSafe(text);
  const names = new Set(rows.map((r) => r.name));
  for (const required of ENV_EXAMPLE_REQUIRED_NAMES) {
    assert.ok(names.has(required), `missing ${required}`);
  }
  const secrets = ["POSTGRES_PASSWORD", "CONTROL_CENTER_BACKUP_KEY", "CONFENGE_MCP_AUTH_TOKEN"];
  for (const name of secrets) {
    const row = rows.find((r) => r.name === name);
    assert.ok(row);
    assert.equal(row.value, "");
    assert.equal(looksLikeSecret(row.value), false);
  }
  const url = rows.find((r) => r.name === "CONTROL_CENTER_DATABASE_URL");
  assert.ok(url);
  assert.doesNotMatch(url.value, /:[^:@/]+@/);
  const apply = rows.find((r) => r.name === "CONTROL_CENTER_APPLY_PRODUCTION");
  assert.equal(apply?.value, "false");
  assert.equal(looksLikeSecret("cc.internal.confenge.local"), false);
  assert.equal(looksLikeSecret("0123456789abcdef0123456789abcdef"), true);
  assert.equal(looksLikeSecret("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc"), true);
  assert.doesNotMatch(text, /sk_live|sk_test/);
});
