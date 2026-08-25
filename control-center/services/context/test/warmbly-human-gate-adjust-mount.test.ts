/**
 * The cohort `adjust` operation as actually mounted by the Context Service.
 *
 * Everything here runs the real `createRequestListener` over a real socket with
 * the real `createWarmblyOperatorHandlerFromEnv` wiring, against a stub Warmbly
 * on loopback. Unit tests in the connector prove the route is narrow; this file
 * proves the deployment does not widen it — same `CC_WARMBLY_OPERATOR_ENABLED`
 * gate, same narrowed trusted hop, same Authelia-only actor, and a 404 rather
 * than a half-mount when the channel is off.
 *
 * The credential is an obvious fixture string in a temp file; no real secret,
 * mailbox or PII appears anywhere in this file.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createRequestListener } from "../src/http.ts";
import { silentLogger } from "../src/log.ts";
import { createWarmblyOperatorHandlerFromEnv } from "../src/warmbly-operator/from-env.ts";
import { makeService } from "./helpers.ts";

const FIXTURE_CREDENTIAL = "wmbly_fixture_operator_credential_0001";
const COHORT = "11111111-1111-4111-8111-111111111111";
const CANDIDATE = "22222222-2222-4222-8222-222222222222";
const ADJUST = `/v1/warmbly/operator/cohorts/${COHORT}/candidates/${CANDIDATE}/adjust`;
const PAUSE = "/v1/warmbly/operator/dispatch/pause";
const LOOPBACK_HOPS = "127.0.0.1,::1,::ffff:127.0.0.1";

const AUTHELIA = {
  "Remote-User": "founder",
  "Remote-Groups": "operators",
  "Remote-Name": "Founder Confenge",
  "Remote-Email": "founder@confenge.invalid",
};

function adjustBody(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    subject: "Assunto revisado da versao congelada",
    body_text: "Corpo revisado, sem destinatario.",
    reason: "ajuste de copy aprovado em revisao",
    confirmation: "v3",
    expected_frozen_hash: "sha256:frozen-fixture-before",
    idempotency_key: "idem-adjust-mount-01",
    ...extra,
  });
}

interface UpstreamHit {
  method: string | undefined;
  url: string | undefined;
  authorization: string | undefined;
  idempotencyKey: string | undefined;
  body: string;
}

/** A stub Warmbly on loopback that records what the edge actually sent. */
async function stubWarmbly(): Promise<{ base: string; hits: UpstreamHit[]; close: () => Promise<void> }> {
  const hits: UpstreamHit[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      hits.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization as string | undefined,
        idempotencyKey: req.headers["idempotency-key"] as string | undefined,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          contract_version: "confenge.human-gate.v1",
          cohort: { id: COHORT, version: 4 },
          adjustment: {
            id: "33333333-3333-4333-8333-333333333333",
            cohort_id: COHORT,
            from_version: 3,
            to_version: 4,
            candidate_id: CANDIDATE,
            before_content_hash: "sha256:content-before",
            after_content_hash: "sha256:content-after",
            before_frozen_hash: "sha256:frozen-fixture-before",
            after_frozen_hash: "sha256:frozen-fixture-after",
            diff: [{ field: "subject", before: "antes", after: "depois" }],
            revoked_authorization_id: "44444444-4444-4444-8444-444444444444",
            actor_id: "authelia:0000000000000000",
            correlation_id: "wmbly:adjust:fixture",
            receipt: "adjust:r1",
            created_at: "2026-08-23T12:00:00Z",
          },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  return {
    base: `http://127.0.0.1:${addr.port}`,
    hits,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  return `http://127.0.0.1:${addr.port}`;
}

/**
 * Boots the Context Service with the operator channel wired from `env` exactly
 * as production does — no injected fetch, no injected handler.
 */
async function withContext(
  env: NodeJS.ProcessEnv,
  fn: (base: string, wired: boolean) => Promise<void>,
): Promise<void> {
  const { service } = makeService();
  const handler = await createWarmblyOperatorHandlerFromEnv(env, { logger: silentLogger });
  const server = createServer(
    createRequestListener({
      service,
      logger: silentLogger,
      ...(handler ? { warmblyOperator: handler } : {}),
    }),
  );
  const base = await listen(server);
  try {
    await fn(base, handler !== undefined);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

function credentialFile(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "cc-adjust-mount-"));
  const path = join(dir, "warmbly_operator_credential");
  writeFileSync(path, `${FIXTURE_CREDENTIAL}\n`, { mode: 0o600 });
  return { dir, path };
}

/** Writes a request line verbatim, without the client-side URL normalisation. */
async function rawPost(base: string, path: string): Promise<string> {
  const { port } = new URL(base);
  const body = adjustBody();
  return await new Promise<string>((resolve, reject) => {
    const socket = connect(Number(port), "127.0.0.1", () => {
      socket.write(
        `POST ${path} HTTP/1.1\r\n`
          + `Host: 127.0.0.1:${port}\r\n`
          + `Content-Type: application/json\r\n`
          + Object.entries(AUTHELIA).map(([k, v]) => `${k}: ${v}\r\n`).join("")
          + `Content-Length: ${Buffer.byteLength(body)}\r\n`
          + `Connection: close\r\n\r\n`
          + body,
      );
    });
    const chunks: Buffer[] = [];
    socket.on("data", (c: Buffer) => chunks.push(c));
    socket.on("error", reject);
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

test("adjust 404s exactly like the other operator routes when the channel is disabled", async () => {
  const upstream = await stubWarmbly();
  const { dir, path } = credentialFile();
  try {
    for (const enabled of [undefined, "false", "TRUE", "1"]) {
      await withContext(
        {
          ...(enabled === undefined ? {} : { CC_WARMBLY_OPERATOR_ENABLED: enabled }),
          CC_WARMBLY_BASE_URL: upstream.base,
          CC_WARMBLY_OPERATOR_TOKEN_FILE: path,
          CC_WARMBLY_OPERATOR_TRUSTED_HOPS: LOOPBACK_HOPS,
        } as NodeJS.ProcessEnv,
        async (base, wired) => {
          assert.equal(wired, false, `CC_WARMBLY_OPERATOR_ENABLED=${enabled} must not wire the channel`);
          for (const route of [ADJUST, PAUSE]) {
            const res = await fetch(`${base}${route}`, {
              method: "POST",
              headers: { "content-type": "application/json", ...AUTHELIA },
              body: adjustBody(),
            });
            assert.equal(res.status, 404, route);
            const body = (await res.json()) as { code?: string };
            assert.equal(body.code, "operator_channel_not_configured");
          }
        },
      );
    }
    assert.deepEqual(upstream.hits, [], "a disabled channel must never reach Warmbly");
  } finally {
    await upstream.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adjust stays unmounted when the narrowed trusted hop is missing or the credential is unreadable", async () => {
  const upstream = await stubWarmbly();
  const { dir, path } = credentialFile();
  try {
    const broken: [string, NodeJS.ProcessEnv][] = [
      ["no trusted hop", { CC_WARMBLY_OPERATOR_ENABLED: "true", CC_WARMBLY_BASE_URL: upstream.base, CC_WARMBLY_OPERATOR_TOKEN_FILE: path }],
      ["empty trusted hop list", { CC_WARMBLY_OPERATOR_ENABLED: "true", CC_WARMBLY_BASE_URL: upstream.base, CC_WARMBLY_OPERATOR_TOKEN_FILE: path, CC_WARMBLY_OPERATOR_TRUSTED_HOPS: " , " }],
      ["no base url", { CC_WARMBLY_OPERATOR_ENABLED: "true", CC_WARMBLY_OPERATOR_TOKEN_FILE: path, CC_WARMBLY_OPERATOR_TRUSTED_HOPS: LOOPBACK_HOPS }],
      ["unreadable credential", { CC_WARMBLY_OPERATOR_ENABLED: "true", CC_WARMBLY_BASE_URL: upstream.base, CC_WARMBLY_OPERATOR_TOKEN_FILE: join(dir, "absent"), CC_WARMBLY_OPERATOR_TRUSTED_HOPS: LOOPBACK_HOPS }],
    ];
    for (const [label, env] of broken) {
      await withContext(env, async (base, wired) => {
        assert.equal(wired, false, label);
        const res = await fetch(`${base}${ADJUST}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...AUTHELIA },
          body: adjustBody(),
        });
        assert.equal(res.status, 404, label);
      });
    }
    assert.deepEqual(upstream.hits, [], "a misconfigured channel must never reach Warmbly");
  } finally {
    await upstream.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the mounted adjust route carries the file-backed credential and the idempotency key upstream", async () => {
  const upstream = await stubWarmbly();
  const { dir, path } = credentialFile();
  try {
    await withContext(
      {
        CC_WARMBLY_OPERATOR_ENABLED: "true",
        CC_WARMBLY_BASE_URL: upstream.base,
        CC_WARMBLY_OPERATOR_TOKEN_FILE: path,
        CC_WARMBLY_OPERATOR_TRUSTED_HOPS: LOOPBACK_HOPS,
      },
      async (base, wired) => {
        assert.equal(wired, true);
        const res = await fetch(`${base}${ADJUST}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...AUTHELIA },
          body: adjustBody(),
        });
        assert.equal(res.status, 201);
        const body = (await res.json()) as Record<string, unknown>;
        assert.equal(body.operation, "adjust");
        assert.equal(body.outcome, "APPLIED");
        assert.equal(body.receipt, "adjust:r1");
        assert.deepEqual(body.resource, {
          kind: "cohort",
          id: COHORT,
          version: 4,
          adjustment_id: "33333333-3333-4333-8333-333333333333",
          from_version: 3,
          to_version: 4,
        });
        assert.equal(body.auto_send_enabled, false);
      },
    );
    assert.equal(upstream.hits.length, 1);
    const hit = upstream.hits[0]!;
    assert.equal(hit.method, "POST");
    assert.equal(hit.url, `/v1/confenge/cohorts/${COHORT}/candidates/${CANDIDATE}/adjust`);
    assert.equal(hit.authorization, `Bearer ${FIXTURE_CREDENTIAL}`);
    assert.equal(hit.idempotencyKey, "idem-adjust-mount-01");
    // The edge-only idempotency key is not duplicated into the forwarded body.
    assert.deepEqual(Object.keys(JSON.parse(hit.body) as Record<string, unknown>).sort(), [
      "body_text", "confirmation", "expected_frozen_hash", "reason", "subject",
    ]);
  } finally {
    await upstream.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adjust accepts no client-settable actor and no identity from an untrusted hop", async () => {
  const upstream = await stubWarmbly();
  const { dir, path } = credentialFile();
  try {
    // Same narrowed hop production uses. The loopback test client is not it.
    await withContext(
      {
        CC_WARMBLY_OPERATOR_ENABLED: "true",
        CC_WARMBLY_BASE_URL: upstream.base,
        CC_WARMBLY_OPERATOR_TOKEN_FILE: path,
        CC_WARMBLY_OPERATOR_TRUSTED_HOPS: "10.89.0.2/32",
      },
      async (base, wired) => {
        assert.equal(wired, true);
        const res = await fetch(`${base}${ADJUST}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...AUTHELIA },
          body: adjustBody(),
        });
        assert.equal(res.status, 401, "Remote-* from an untrusted peer must not authenticate a write");
      },
    );

    await withContext(
      {
        CC_WARMBLY_OPERATOR_ENABLED: "true",
        CC_WARMBLY_BASE_URL: upstream.base,
        CC_WARMBLY_OPERATOR_TOKEN_FILE: path,
        CC_WARMBLY_OPERATOR_TRUSTED_HOPS: LOOPBACK_HOPS,
      },
      async (base) => {
        // No Remote-* at all: the client-settable actor headers this service uses
        // elsewhere must not stand in for Authelia here.
        const forged = await fetch(`${base}${ADJUST}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-actor-id": "founder",
            "x-actor-kind": "human",
          },
          body: adjustBody(),
        });
        assert.equal(forged.status, 401);
        const body = (await forged.json()) as Record<string, unknown>;
        assert.equal(body.operation, "adjust");
        assert.equal(body.outcome, "REFUSED");

        // A cross-origin form POST is CORS-simple; requiring JSON is what stops it.
        const formish = await fetch(`${base}${ADJUST}`, {
          method: "POST",
          headers: { "content-type": "text/plain", ...AUTHELIA },
          body: adjustBody(),
        });
        assert.equal(formish.status, 415);
      },
    );
    assert.deepEqual(upstream.hits, [], "no unauthenticated adjust may reach Warmbly");
  } finally {
    await upstream.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the current mount exposes no GO, cohort dispatch, send or queue route", async () => {
  const upstream = await stubWarmbly();
  const { dir, path } = credentialFile();
  try {
    await withContext(
      {
        CC_WARMBLY_OPERATOR_ENABLED: "true",
        CC_WARMBLY_BASE_URL: upstream.base,
        CC_WARMBLY_OPERATOR_TOKEN_FILE: path,
        CC_WARMBLY_OPERATOR_TRUSTED_HOPS: LOOPBACK_HOPS,
      },
      async (base) => {
        const hostile = [
          `/v1/warmbly/operator/cohorts/${COHORT}/send`,
          `/v1/warmbly/operator/cohorts/${COHORT}/queue`,
          `/v1/warmbly/operator/cohorts/${COHORT}/decision`,
          `/v1/warmbly/operator/cohorts/${COHORT}/dispatch`,
          `/v1/warmbly/operator/cohorts/${COHORT}/candidates/${CANDIDATE}/send`,
          `/v1/warmbly/operator/cohorts/${COHORT}/candidates/${CANDIDATE}/dispatch`,
          `/v1/warmbly/operator/cohorts/${COHORT}/candidates/${CANDIDATE}/adjust/send`,
        ];
        for (const route of hostile) {
          const res = await fetch(`${base}${route}`, {
            method: "POST",
            headers: { "content-type": "application/json", ...AUTHELIA },
            body: adjustBody(),
          });
          assert.ok(res.status === 404, `${route} answered ${res.status}`);
          await res.text();
        }

        // `fetch` collapses `..` before the request line is written, so a raw
        // socket is the only way to make the server itself see the traversal.
        //
        // What it proves is worth stating precisely, because the answer is not a
        // 404. `createRequestListener` normalises the path through `new URL`
        // before dispatch, so `cohorts/../dispatch/resume` becomes the operator
        // channel's own `dispatch/resume` — a route that has been deliberately
        // allowlisted since long before adjust existed. Traversal therefore
        // reaches nothing it could not reach by asking for it directly, and that
        // route fail-closes on its own two-step confirmation: 428, outcome
        // `refused`, and no byte written to Warmbly. The property under test is
        // that traversal grants no new capability, not that the string 404s.
        const raw = await rawPost(base, `/v1/warmbly/operator/cohorts/../dispatch/resume`);
        assert.match(raw, /^HTTP\/1\.1 428 /, raw.split("\r\n")[0] ?? "");
        assert.match(raw, /"outcome":"refused"/);
        assert.match(raw, /"code":"confirmation_required"/);
        assert.doesNotMatch(raw, /adjust:r1/, "traversal must not reach the cohort surface");
      },
    );
    assert.deepEqual(upstream.hits, [], "no hostile cohort route may reach Warmbly");
  } finally {
    await upstream.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
