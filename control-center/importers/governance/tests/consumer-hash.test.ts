/**
 * Fresh consumer: loads the shipped public entry (src/index.ts), not the
 * parser unit file. Computes the content hash from fixture bytes here.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { importGovernance } from "../src/index.js";
import { EXPLICIT_ADR, FIXED_NOW, FIXTURE_ROOT, fixtureGit } from "./helpers.js";

describe("fresh consumer of shipped importGovernance", () => {
  it("returns kind=decision and a content hash equal to sha256 of the fixture bytes", async () => {
    const bytes = readFileSync(EXPLICIT_ADR);
    const expectedHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

    const result = await importGovernance({
      root: FIXTURE_ROOT,
      now: FIXED_NOW,
      git: fixtureGit(),
      files: [
        {
          path: "decisions/ADR-SYNTHETIC-EXPLICIT-001.md",
          bytes: new Uint8Array(bytes),
        },
      ],
      dryRun: true,
    });

    assert.equal(result.candidates.length, 1);
    const candidate = result.candidates[0];
    assert.ok(candidate);
    assert.equal(candidate.kind, "decision");
    assert.equal(candidate.content_hash, expectedHash);
    assert.equal(candidate.source_path, "decisions/ADR-SYNTHETIC-EXPLICIT-001.md");
  });
});
