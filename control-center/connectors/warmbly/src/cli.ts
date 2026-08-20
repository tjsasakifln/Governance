#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collect, collectFromWarmblyPayload } from "./collect.ts";
import type { WarmblyPayload } from "./contracts/warmbly-payload.ts";
import { WarmblyClient } from "./http/client.ts";
import { createStderrLogger } from "./http/redaction.ts";
import { startFixtureStub } from "./stub-server.ts";

function argValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) {
    return undefined;
  }
  return args[idx + 1];
}

function parseNow(raw: string | undefined): Date | undefined {
  if (!raw) {
    return undefined;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid --now: ${raw}`);
  }
  return d;
}

async function loadPayload(path: string): Promise<WarmblyPayload> {
  const text = await readFile(path, "utf8");
  return JSON.parse(text) as WarmblyPayload;
}

async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const fixture = argValue(args, "--fixture");
  const stubFixture = argValue(args, "--stub-fixture") ?? (args.includes("--stub") ? undefined : undefined);
  const now = parseNow(argValue(args, "--now") ?? process.env.WARMBLY_OBSERVED_AT);
  const logger = createStderrLogger();

  if (fixture) {
    const payload = await loadPayload(resolve(fixture));
    const snapshot = collectFromWarmblyPayload(payload, { now });
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    return;
  }

  const inlineStub = args.includes("--stub") || Boolean(stubFixture);
  if (inlineStub) {
    const fixturePath =
      stubFixture ??
      resolve(fileURLToPath(new URL("../fixtures/commercial-runtime.json", import.meta.url)));
    const payload = await loadPayload(fixturePath);
    const hide = args.includes("--hide-confenge")
      ? [
          "/v1/confenge/attention",
          "/v1/confenge/today",
          "/v1/confenge/inbound",
          "/v1/confenge/ops/health",
        ]
      : [];
    const token = process.env.WARMBLY_API_TOKEN ?? process.env.WARMBLY_API_KEY ?? "wmbly_stub_local_token";
    const stub = await startFixtureStub({ payload, hide, token });
    try {
      const snapshot = await collect({
        now,
        client: new WarmblyClient({
          baseUrl: stub.url,
          token,
          timeoutMs: 3_000,
          maxRetries: 0,
          logger,
        }),
      });
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    } finally {
      await stub.close();
    }
    return;
  }

  const baseUrl = process.env.WARMBLY_BASE_URL;
  const token = process.env.WARMBLY_API_TOKEN ?? process.env.WARMBLY_API_KEY;
  if (!baseUrl || !token) {
    throw new Error(
      "Set WARMBLY_BASE_URL and WARMBLY_API_TOKEN, or pass --fixture / --stub. See README.md.",
    );
  }
  const snapshot = await collect({
    now,
    client: new WarmblyClient({
      baseUrl,
      token,
      logger,
    }),
  });
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
}

main(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "cli failed";
  process.stderr.write(`${JSON.stringify({ level: "error", msg: "warmbly.cli.fail", error: message })}\n`);
  process.exitCode = 1;
});
