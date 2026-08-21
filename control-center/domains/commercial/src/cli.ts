#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { parseUtc } from "./clock.ts";
import { logStructured } from "./log.ts";
import { runFixture } from "./load-fixture.ts";

function argValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) {
    return undefined;
  }
  return args[idx + 1];
}

function defaultFixture(): string {
  return (
    process.env.COMMERCIAL_READMODEL_FIXTURE ??
    fileURLToPath(new URL("../fixtures/representative.json", import.meta.url))
  );
}

function parseNow(raw: string | undefined) {
  if (!raw) {
    return undefined;
  }
  const d = parseUtc(raw);
  if (!d) {
    throw new Error(`invalid --now: ${raw}`);
  }
  return d;
}

async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const fixture = argValue(args, "--fixture") ?? defaultFixture();
  const now = parseNow(
    argValue(args, "--now") ?? process.env.COMMERCIAL_READMODEL_NOW,
  );
  logStructured("info", "commercial.summary.start", {
    fixture,
    now_pinned: Boolean(now),
  });
  const summary = runFixture(fixture, { now });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  logStructured("info", "commercial.summary.done", {
    funnel_keys: Object.keys(summary.funnel),
    attention: summary.attention.items.length,
    exceptions: summary.exceptions.length,
    nominal: summary.pipeline.nominal.treatment,
    weighted: summary.pipeline.weighted.treatment,
  });
}

main(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "cli failed";
  logStructured("error", "commercial.summary.fail", { error: message });
  process.exitCode = 1;
});
