import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAllowlist } from "../src/allowlist.js";
import { loadFixtureFile } from "./helpers.js";

test("shipped healthy fixture allowlist parses", () => {
  const allowlist = parseAllowlist(loadFixtureFile("healthy.json").allowlist);
  assert.equal(allowlist.source, "infrastructure");
  assert.equal(allowlist.targets.length, 3);
  assert.ok(allowlist.targets.some((t) => t.checks.includes("backup")));
  assert.ok(allowlist.targets.some((t) => t.checks.includes("tls")));
});

test("allowlist rejects secrets, SSH material, and credential URLs", () => {
  const base = loadFixtureFile("healthy.json").allowlist as Record<string, unknown>;
  assert.throws(
    () => parseAllowlist({ ...base, ssh_key: "ssh-ed25519 AAAA" }),
    /secret/i,
  );
  assert.throws(
    () => parseAllowlist({ ...base, password: "nope" }),
    /secret/i,
  );
  assert.throws(
    () =>
      parseAllowlist({
        ...base,
        targets: [
          {
            id: "bad",
            display_name: "bad",
            url: "https://user:pass@example.internal/health",
            checks: ["http"],
          },
        ],
      }),
    /credential/i,
  );
  assert.throws(
    () => parseAllowlist({ ...base, note: "-----BEGIN PRIVATE KEY-----" }),
    /secret or key/i,
  );
});

test("allowlist requires unique ids and known checks", () => {
  const base = loadFixtureFile("healthy.json").allowlist as Record<string, unknown>;
  assert.throws(
    () =>
      parseAllowlist({
        ...base,
        targets: [
          { id: "dup", display_name: "a", host: "h", checks: ["reachability"] },
          { id: "dup", display_name: "b", host: "h2", checks: ["reachability"] },
        ],
      }),
    /duplicate/i,
  );
  assert.throws(
    () =>
      parseAllowlist({
        ...base,
        targets: [{ id: "x", display_name: "x", checks: ["ping"] }],
      }),
    /must be one of/i,
  );
});
