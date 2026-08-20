import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgv, runCli } from "../src/cli.js";
import { FIXED_NOW, FIXED_SHA, FIXTURE_ROOT } from "./helpers.js";
import type { ImportResult } from "../src/types.js";

describe("dry-run CLI entry", () => {
  it("parses --now and --commit-sha and defaults to dry-run", () => {
    const args = parseArgv([
      "--root",
      FIXTURE_ROOT,
      "--now",
      FIXED_NOW.toISOString(),
      "--commit-sha",
      FIXED_SHA,
    ]);
    assert.equal(args.persist, false);
    assert.equal(args.now, FIXED_NOW.toISOString());
    assert.equal(args.commitSha, FIXED_SHA);
  });

  it("refuses --persist", async () => {
    const stderr: string[] = [];
    const outcome = await runCli(
      ["--root", FIXTURE_ROOT, "--persist"],
      {},
      {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
      },
    );
    assert.equal(outcome.code, 2);
    assert.match(stderr.join("\n"), /PERSIST_DISABLED/);
  });

  it("prints parseable candidates and unclassifiable report twice with identical keys", async () => {
    const run = async (): Promise<{ code: number; parsed: ImportResult; stdout: string }> => {
      let stdout = "";
      const outcome = await runCli(
        [
          "--root",
          FIXTURE_ROOT,
          "--now",
          FIXED_NOW.toISOString(),
          "--commit-sha",
          FIXED_SHA,
        ],
        {},
        {
          stdout: (line) => {
            stdout += line;
          },
          stderr: () => {},
        },
      );
      assert.equal(outcome.code, 0);
      const parsed = JSON.parse(stdout) as ImportResult;
      return { code: outcome.code, parsed, stdout };
    };

    const first = await run();
    const second = await run();
    assert.equal(first.parsed.dry_run, true);
    assert.ok(first.parsed.candidates.length >= 3);
    assert.ok(first.parsed.unclassifiable.length >= 1);
    assert.deepEqual(
      first.parsed.candidates.map((candidate) => ({
        id: candidate.id,
        kind: candidate.kind,
        content_hash: candidate.content_hash,
        idempotency_key: candidate.idempotency_key,
      })),
      second.parsed.candidates.map((candidate) => ({
        id: candidate.id,
        kind: candidate.kind,
        content_hash: candidate.content_hash,
        idempotency_key: candidate.idempotency_key,
      })),
    );
    assert.equal(first.stdout.includes("ghp_"), false);
    assert.equal(first.stdout.toLowerCase().includes("password"), false);
  });
});
