import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { FUNNEL_KEYS } from "../src/contracts.ts";
import { runFixture } from "../src/load-fixture.ts";
import { fixturePath, NOW } from "./helpers.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "src", "cli.ts");

describe("launchable fixture runner", () => {
  it("runFixture drives the shipped projection on the representative fixture", () => {
    const summary = runFixture(fixturePath("representative.json"), { now: NOW });
    for (const key of FUNNEL_KEYS) {
      assert.ok(key in summary.funnel);
    }
    assert.ok(summary.attention.items.length <= 3);
    assert.equal(summary.pipeline.nominal.treatment, "present");
  });

  it("CLI prints JSON twice with identical commercial content", () => {
    const args = [
      CLI,
      "--fixture",
      fixturePath("representative.json"),
      "--now",
      "2026-08-20T12:00:00Z",
    ];
    const tsxBin = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
    const first = spawnSync(process.execPath, [tsxBin, ...args], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const second = spawnSync(process.execPath, [tsxBin, ...args], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    const a = JSON.parse(first.stdout) as { funnel: unknown; attention: unknown; pipeline: unknown };
    const b = JSON.parse(second.stdout) as { funnel: unknown; attention: unknown; pipeline: unknown };
    assert.deepEqual(a.funnel, b.funnel);
    assert.deepEqual(a.attention, b.attention);
    assert.deepEqual(a.pipeline, b.pipeline);
    assert.equal(first.stdout, second.stdout);
  });
});
