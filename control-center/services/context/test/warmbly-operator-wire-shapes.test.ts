/**
 * The wire shapes the Control Center cockpit classifies.
 *
 * `apps/web-shell` turns a dispatch response into "executada / recusada /
 * falhou" plus a recovery instruction, and it has to do that from the response
 * body alone — three of the outcomes that matter most share HTTP 503. If the
 * shell's idea of that body drifts from what the service actually sends, the
 * cockpit will confidently tell an operator that nothing was applied when
 * something may have been.
 *
 * So the shapes are recorded once, in
 * `connectors/warmbly/fixtures/operator-http-responses.json`, and pinned from
 * both ends: this test drives the *real* context HTTP server with the *real*
 * operator channel over real sockets and asserts the recorded status and body
 * still match; `apps/web-shell/tests/warmbly-operation.test.ts` replays the
 * same file through the real read adapter. Neither side gets to invent a shape
 * the other has never seen.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createMemoryOperatorActionLedger,
  createOperatorHttpHandler,
  createWarmblyOperatorChannel,
  defaultOperatorIdentityPolicy,
  WarmblyOperatorClient,
} from "@confenge/control-center-warmbly-connector";

import { createRequestListener } from "../src/http.ts";
import { silentLogger } from "../src/log.ts";
import { makeService } from "./helpers.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "../../../connectors/warmbly/fixtures/operator-http-responses.json");

const TOKEN = "wmbly_test_operator_token";
const LOOPBACK_HOPS = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
const AUTHELIA = {
  "Remote-User": "founder",
  "Remote-Groups": "operators",
  "Remote-Name": "Founder Confenge",
  "Remote-Email": "founder@confenge.invalid",
};

interface RecordedCase {
  name: string;
  route: string;
  status: number;
  body: Record<string, unknown>;
}

/**
 * Everything the channel mints fresh per call. Pinning these would pin a clock
 * and a ULID generator, not a shape, so they are replaced by a marker and the
 * marker itself is asserted to have been present.
 */
const VOLATILE = ["correlation_id", "ledger_id", "recorded_at", "confirmation_token", "expires_at"];

function normalize(body: unknown): Record<string, unknown> {
  const record = body && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {};
  for (const key of VOLATILE) {
    if (key in record) record[key] = "<volatile>";
  }
  return record;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  return `http://127.0.0.1:${addr.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

/** A Warmbly stand-in that answers every allowed operator write with one status. */
async function warmblyStub(status: number): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: { path: req.url, accepted: status < 300 } }));
  });
  const url = await listen(server);
  return { url, close: () => close(server) };
}

async function contextServer(
  upstreamUrl: string | undefined,
  failureThreshold: number,
): Promise<{ base: string; close: () => Promise<void> }> {
  const { service } = makeService();
  let warmblyOperator;
  if (upstreamUrl) {
    const client = new WarmblyOperatorClient({
      baseUrl: upstreamUrl,
      token: TOKEN,
      timeoutMs: 2_000,
      failureThreshold,
      logger: () => undefined,
    });
    const channel = createWarmblyOperatorChannel({
      client,
      ledger: createMemoryOperatorActionLedger(),
      identityPolicy: defaultOperatorIdentityPolicy(LOOPBACK_HOPS),
      logger: () => undefined,
    });
    warmblyOperator = createOperatorHttpHandler(channel);
  }
  const server = createServer(
    createRequestListener({
      service,
      logger: silentLogger,
      ...(warmblyOperator ? { warmblyOperator } : {}),
    }),
  );
  const base = await listen(server);
  return { base, close: () => close(server) };
}

async function post(
  base: string,
  route: string,
  options: { headers?: Record<string, string>; body?: unknown; contentType?: string } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${route}`, {
    method: "POST",
    headers: {
      "content-type": options.contentType ?? "application/json",
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(options.body ?? {}),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function recorded(): RecordedCase[] {
  const parsed = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: RecordedCase[] };
  assert.ok(Array.isArray(parsed.cases) && parsed.cases.length > 0, "the recorded fixture is empty");
  return parsed.cases;
}

function expect(cases: RecordedCase[], name: string): RecordedCase {
  const found = cases.find((item) => item.name === name);
  assert.ok(found, `no recorded case named ${name}`);
  return found;
}

function assertMatches(
  cases: RecordedCase[],
  name: string,
  actual: { status: number; body: Record<string, unknown> },
): void {
  const want = expect(cases, name);
  assert.equal(actual.status, want.status, `${name}: status drifted`);
  assert.deepEqual(normalize(actual.body), want.body, `${name}: body shape drifted`);
}

test("the live operator channel still answers with the recorded wire shapes", async () => {
  const cases = recorded();
  const upstream = await warmblyStub(200);
  const ctx = await contextServer(upstream.url, 3);
  try {
    assertMatches(
      cases,
      "executed",
      await post(ctx.base, "/v1/warmbly/operator/dispatch/pause", {
        headers: AUTHELIA,
        body: { reason: "pico de bounce" },
      }),
    );
    const challenged = await post(ctx.base, "/v1/warmbly/operator/dispatch/resume/confirm", {
      headers: AUTHELIA,
      body: { reason: "bounce normalizado" },
    });
    assert.equal(
      typeof challenged.body.confirmation_token,
      "string",
      "the challenge must actually mint a token, not just a shape with the key",
    );
    assertMatches(cases, "challenged", challenged);
    assertMatches(
      cases,
      "confirmation_required",
      await post(ctx.base, "/v1/warmbly/operator/dispatch/resume", {
        headers: AUTHELIA,
        body: { reason: "bounce normalizado" },
      }),
    );
    assertMatches(
      cases,
      "confirmation_invalid",
      await post(ctx.base, "/v1/warmbly/operator/dispatch/resume", {
        headers: AUTHELIA,
        body: { reason: "bounce normalizado", confirmation_token: "wcnf_nao_existe" },
      }),
    );
    assertMatches(
      cases,
      "missing_actor",
      await post(ctx.base, "/v1/warmbly/operator/dispatch/pause", { body: { reason: "sem identidade" } }),
    );
    assertMatches(
      cases,
      "invalid_reason",
      await post(ctx.base, "/v1/warmbly/operator/dispatch/pause", { headers: AUTHELIA, body: {} }),
    );
    assertMatches(
      cases,
      "invalid_target",
      await post(ctx.base, "/v1/warmbly/operator/inbound/acknowledge", {
        headers: AUTHELIA,
        body: { reason: "visto" },
      }),
    );
    assertMatches(
      cases,
      "unsupported_media_type",
      await post(ctx.base, "/v1/warmbly/operator/dispatch/pause", {
        headers: AUTHELIA,
        body: { reason: "pico de bounce" },
        contentType: "text/plain",
      }),
    );
  } finally {
    await ctx.close();
    await upstream.close();
  }
});

test("a failing Warmbly yields the recorded 502, then the recorded open-circuit 503", async () => {
  const cases = recorded();
  const upstream = await warmblyStub(500);
  // One failure is enough to open the breaker, so the second call is refused
  // without being attempted — the case that also refuses *pause*.
  const ctx = await contextServer(upstream.url, 1);
  try {
    assertMatches(
      cases,
      "upstream_error",
      await post(ctx.base, "/v1/warmbly/operator/dispatch/pause", {
        headers: AUTHELIA,
        body: { reason: "pico de bounce" },
      }),
    );
    const open = await post(ctx.base, "/v1/warmbly/operator/dispatch/pause", {
      headers: AUTHELIA,
      body: { reason: "pico de bounce" },
    });
    assertMatches(cases, "circuit_open", open);
    assert.match(
      String(open.body.reason),
      /deploy\/confenge-vps\/pause\.sh/,
      "an open circuit refuses pause too, so the refusal has to name the out-of-band fallback",
    );
  } finally {
    await ctx.close();
    await upstream.close();
  }
});

test("a deployment with the channel switched off answers the recorded 404", async () => {
  const cases = recorded();
  const ctx = await contextServer(undefined, 3);
  try {
    assertMatches(
      cases,
      "channel_not_configured",
      await post(ctx.base, "/v1/warmbly/operator/dispatch/pause", {
        headers: AUTHELIA,
        body: { reason: "pico de bounce" },
      }),
    );
  } finally {
    await ctx.close();
  }
});
