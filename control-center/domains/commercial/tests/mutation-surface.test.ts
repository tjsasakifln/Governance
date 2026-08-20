import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (full.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("read-only mutation surface", () => {
  const files = walk(SRC);
  const joined = files.map((f) => readFileSync(f, "utf8")).join("\n");

  it("does not ship an HTTP mutation client", () => {
    assert.equal(/new\s+WarmblyClient/.test(joined), false);
    assert.equal(/asaas\.com/i.test(joined), false);
    assert.equal(/\bfetch\s*\(/.test(joined), false);
    assert.equal(/http\.request/.test(joined), false);
    assert.equal(/https\.request/.test(joined), false);
    assert.equal(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(joined), false);
  });

  it("does not reference checkout, refund, or send-commercial actions as callable APIs", () => {
    assert.equal(/createPayment|refundPayment|cancelSubscription/.test(joined), false);
    assert.equal(/auto_send|sendCampaign/.test(joined), false);
  });

  it("ships the projection and CLI entrypoints", () => {
    assert.equal(files.some((f) => f.endsWith("project.ts")), true);
    assert.equal(files.some((f) => f.endsWith("cli.ts")), true);
    assert.equal(joined.includes("export function projectCommercialSummary"), true);
  });
});
