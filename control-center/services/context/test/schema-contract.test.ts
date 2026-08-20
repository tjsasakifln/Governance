import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createStoreFromEnv } from "../src/store/from-env.ts";
import { ServiceError } from "../src/errors.ts";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "src");
const sqlPath = join(srcRoot, "store", "expected-schema.sql");

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTs(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

test("expected-schema.sql is a test-only contract of canonical PersistencePort records", () => {
  const sql = readFileSync(sqlPath, "utf8");
  assert.match(sql, /TEST CONTRACT ONLY/);
  assert.match(sql, /MUST NOT load/);
  assert.match(sql, /at runtime/);
  assert.match(sql, /scope TEXT NOT NULL/);
  assert.doesNotMatch(sql, /scope_company/);
  assert.doesNotMatch(sql, /scope_domain/);
  assert.doesNotMatch(sql, /scope_resource/);
  assert.match(sql, /status TEXT NOT NULL CHECK \(status IN \('draft', 'active', 'superseded', 'revoked', 'expired'\)\)/);
  assert.doesNotMatch(sql, /'inactive'/);
  assert.match(sql, /freshness_status TEXT NOT NULL CHECK \(freshness_status IN \('FRESH', 'STALE', 'UNKNOWN', 'ERROR'\)\)/);
  assert.doesNotMatch(sql, /'fresh'| 'stale'| 'unknown'/);
  assert.match(sql, /supersedes TEXT\[\]/);
  assert.match(sql, /created_by_kind TEXT NOT NULL CHECK \(created_by_kind IN \('human', 'agent', 'system'\)\)/);
  assert.match(sql, /source_system TEXT NOT NULL/);
  assert.match(sql, /source_kind TEXT NOT NULL/);
  assert.match(sql, /source_locator TEXT NOT NULL/);
  assert.match(sql, /confidence DOUBLE PRECISION NOT NULL/);

  for (const file of walkTs(srcRoot)) {
    const body = readFileSync(file, "utf8");
    assert.equal(body.includes("readFile") && body.includes("expected-schema.sql"), false);
    assert.doesNotMatch(body, /from ["'].*expected-schema/);
    if (file.endsWith("from-env.ts") || file.endsWith("boot.ts") || file.endsWith("server.ts")) {
      assert.doesNotMatch(body, /expected-schema\.sql/);
    }
  }
});

test("package has no postgres production dependency and DATABASE_URL still fail-closes", () => {
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const name of Object.keys(deps)) {
    assert.equal(["pg", "postgres", "postgresql"].includes(name), false);
  }
  assert.throws(
    () => createStoreFromEnv({ DATABASE_URL: "postgresql://127.0.0.1/control_center" }),
    (err: unknown) => err instanceof ServiceError && err.code === "store_misconfigured",
  );
});
