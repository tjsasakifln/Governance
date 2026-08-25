import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createHumanGateHttpHandler,
  HUMAN_GATE_PREFIX,
  HUMAN_GATE_STATUS_PATH,
} from "../src/human-gate/http.ts";
import { defaultOperatorIdentityPolicy } from "../src/operator/identity.ts";

const hop = "10.89.0.2";
const COHORT = "11111111-1111-4111-8111-111111111111";
const CANDIDATE = "22222222-2222-4222-8222-222222222222";

function request(method: string, url: string, groups = "operators", body: unknown = {}) {
  return {
    method,
    url,
    remoteAddress: hop,
    headers: {
      "Remote-User": "founder",
      "Remote-Groups": groups,
      "Remote-Name": "Founder",
      "Remote-Email": "founder@confenge.invalid",
    },
    body,
  };
}

function makeHandler(fetchImpl: typeof fetch) {
  return createHumanGateHttpHandler({
    baseUrl: "https://warmbly.invalid",
    token: "wmbly_secret_12345678",
    identityPolicy: defaultOperatorIdentityPolicy([hop]),
    fetchImpl,
  });
}

describe("Warmbly human gate fixed proxy", () => {
  it("denies missing identity before touching Warmbly", async () => {
    let hits = 0;
    const handler = makeHandler(async () => { hits += 1; return new Response("{}"); });
    const res = await handler({ method: "GET", url: HUMAN_GATE_PREFIX, remoteAddress: hop, headers: {}, body: {} });
    assert.equal(res.status, 401);
    assert.equal(hits, 0);
    assert.equal(res.body.contract_version, "confenge.human-gate.v1");
    assert.equal(res.body.freshness, "UNKNOWN");
    assert.equal(res.body.auto_send_enabled, false);
    assert.match(String(res.body.receipt), /^edge:cc:human-gate:/);
  });

  it("keeps APPROVE with operators; admins without operators are refused before upstream", async () => {
    let hits = 0;
    const handler = makeHandler(async () => { hits += 1; return new Response("{}"); });
    const path = `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}/review`;
    const denied = await handler(request("POST", path, "admins", {
      decision: "APPROVE", reason: "fixture", acknowledged: true, idempotency_key: "idem-review-admin",
    }));
    assert.equal(denied.status, 401);
    assert.equal(denied.body.operation, "review");
    assert.equal(hits, 0);
  });

  it("keeps reconciliation with admins; operators are refused before upstream", async () => {
    let hits = 0;
    const handler = makeHandler(async () => { hits += 1; return new Response("{}"); });
    const denied = await handler(request("POST", `${HUMAN_GATE_PREFIX}/reconcile-approved`, "operators", {
      idempotency_key: "idem-reconcile-denied",
    }));
    assert.equal(denied.status, 403);
    assert.equal(denied.body.operation, "reconcile");
    assert.equal(hits, 0);
  });

  it("forwards APPROVE only on the fixed route, strips browser actor and preserves acknowledgement and idempotency", async () => {
    let seen: { url?: string; body?: Record<string, unknown>; headers?: Headers } = {};
    const handler = makeHandler(async (input, init) => {
      seen = {
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        headers: new Headers(init?.headers),
      };
      return new Response(JSON.stringify({ receipt: "review:r1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const res = await handler(request(
      "POST",
      `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}/review`,
      "operators",
      {
        decision: "APPROVE",
        reason: "evidência válida",
        acknowledged: true,
        actor_id: "attacker",
        idempotency_key: "idem-12345678",
      },
    ));
    assert.equal(res.status, 200);
    assert.equal(seen.url, `https://warmbly.invalid/v1/confenge/cohorts/${COHORT}/candidates/${CANDIDATE}/review`);
    assert.equal(seen.headers?.get("idempotency-key"), "idem-12345678");
    assert.equal(seen.body?.actor_id, undefined);
    assert.equal(seen.body?.acknowledged, true);
    assert.equal(seen.headers?.has("x-actor-id"), false);
  });

  it("forwards server-managed next-page and recovery selection without exposing an offset", async () => {
    const bodies: Record<string, unknown>[] = [];
    const handler = makeHandler(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ receipt: "cohort:r1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    await handler(request("POST", HUMAN_GATE_PREFIX, "operators", {
      limit: 10,
      selection_mode: "NEXT_UNCLAIMED",
      offset: 100,
      idempotency_key: "idem-next-unclaimed",
    }));
    await handler(request("POST", HUMAN_GATE_PREFIX, "operators", {
      limit: 10,
      selection_mode: "RECOVER_PRIOR",
      recover_version_ids: [COHORT],
      idempotency_key: "idem-recover-prior",
    }));
    assert.deepEqual(bodies[0], { limit: 10, selection_mode: "NEXT_UNCLAIMED" });
    assert.deepEqual(bodies[1], {
      limit: 10,
      selection_mode: "RECOVER_PRIOR",
      recover_version_ids: [COHORT],
    });
  });

  it("lets only admins reconcile durable approvals and forwards no caller target", async () => {
    let hits = 0;
    let seenUrl = "";
    let seenBody: Record<string, unknown> = { unexpected: true };
    const handler = makeHandler(async (input, init) => {
      hits += 1;
      seenUrl = String(input);
      seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ data: { scheduled: 4, already_scheduled: 7, failed: 0 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const denied = await handler(request("POST", `${HUMAN_GATE_PREFIX}/reconcile-approved`, "operators", {
      idempotency_key: "idem-reconcile-approvals",
      cohort_id: "attacker-controlled",
    }));
    assert.equal(denied.status, 403);
    assert.equal(hits, 0);
    const allowed = await handler(request("POST", `${HUMAN_GATE_PREFIX}/reconcile-approved`, "admins,operators", {
      idempotency_key: "idem-reconcile-approvals",
      cohort_id: "attacker-controlled",
    }));
    assert.equal(allowed.status, 200);
    assert.equal(hits, 1);
    assert.equal(seenUrl, "https://warmbly.invalid/v1/confenge/cohorts/reconcile-approved");
    assert.deepEqual(seenBody, {});
  });

  it("forwards the server-owned outbound status through one fixed read route", async () => {
    let seen = "";
    const handler = makeHandler(async (input) => {
      seen = String(input);
      return new Response(JSON.stringify({
        kill_switch: false,
        sending_allowed: true,
        auto_send_enabled: true,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const res = await handler(request("GET", HUMAN_GATE_STATUS_PATH));
    assert.equal(res.status, 200);
    assert.equal(seen, "https://warmbly.invalid/v1/confenge/status");
    assert.equal(res.body.kill_switch, false);
    assert.equal(res.body.sending_allowed, true);
    assert.equal(res.body.auto_send_enabled, true, "status telemetry must not be overwritten by the edge");
  });

  it("keeps absent auto-send absent on the outbound status read", async () => {
    const handler = makeHandler(async () => new Response(JSON.stringify({
      kill_switch: true,
      sending_allowed: false,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const res = await handler(request("GET", HUMAN_GATE_STATUS_PATH));
    assert.equal(res.status, 200);
    assert.equal(res.body.auto_send_enabled, undefined);
  });

  it("allows the exact candidate read and nothing below it", async () => {
    let seen = "";
    const handler = makeHandler(async (input) => {
      seen = String(input);
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });
    const path = `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}`;
    assert.equal((await handler(request("GET", path))).status, 200);
    assert.equal(seen, `https://warmbly.invalid/v1/confenge/cohorts/${COHORT}/candidates/${CANDIDATE}`);
    assert.equal((await handler(request("GET", `${path}/raw`))).status, 404);
  });

  it("audits the Authelia actor as an opaque reference without logging PII", async () => {
    const logs: unknown[] = [];
    const handler = createHumanGateHttpHandler({
      baseUrl: "https://warmbly.invalid",
      token: "wmbly_secret_12345678",
      identityPolicy: defaultOperatorIdentityPolicy([hop]),
      logger: (entry) => { logs.push(entry); },
      fetchImpl: async () => new Response(JSON.stringify({ receipt: "cohort:r1" }), { status: 200 }),
    });
    const res = await handler(request("GET", HUMAN_GATE_PREFIX));
    const serialized = JSON.stringify(logs);
    assert.equal(res.status, 200);
    assert.match(serialized, /authelia:[a-f0-9]{16}/);
    assert.doesNotMatch(serialized, /founder|@confenge\.invalid|Remote-/i);
  });

  it("reports timeout after write as unknown and never retries", async () => {
    let hits = 0;
    const handler = createHumanGateHttpHandler({
      baseUrl: "https://warmbly.invalid",
      token: "wmbly_secret_12345678",
      identityPolicy: defaultOperatorIdentityPolicy([hop]),
      timeoutMs: 1,
      fetchImpl: async (_input, init) => {
        hits += 1;
        await new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
        return new Response("{}");
      },
    });
    const res = await handler(request("POST", HUMAN_GATE_PREFIX, "operators", { limit: 2, idempotency_key: "idem-timeout-123" }));
    assert.equal(res.status, 503);
    assert.equal(res.body.code, "human_gate_transport_unknown");
    assert.equal(res.body.source, "warmbly.controlled-outbound");
    assert.equal(res.body.auto_send_enabled, false);
    assert.equal(hits, 1);
  });

  it("rejects reconciliation without a caller-stable idempotency key before upstream", async () => {
    let hits = 0;
    const handler = makeHandler(async () => { hits += 1; return new Response("{}"); });
    const res = await handler(request("POST", `${HUMAN_GATE_PREFIX}/reconcile-approved`, "admins,operators", {}));
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "idempotency_key_required");
    assert.equal(hits, 0);
  });

  it("preserves upstream determinate failures without retry", async () => {
    for (const [status, code] of [[400, "invalid_payload"], [401, "unauthorized"], [403, "write_denied"], [409, "idempotency_payload_conflict"]] as const) {
      let hits = 0;
      const handler = makeHandler(async () => {
        hits += 1;
        return new Response(JSON.stringify({ ok: false, code, reason: "fixture refusal" }), {
          status,
          headers: { "content-type": "application/json" },
        });
      });
      const res = await handler(request(
        "POST",
        `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}/review`,
        "operators",
        { decision: "APPROVE", reason: "fixture", acknowledged: true, idempotency_key: `idem-${status}-fixture` },
      ));
      assert.equal(res.status, status);
      assert.equal(res.body.code, code);
      assert.equal(hits, 1, `${status} must never be retried by the edge`);
    }
  });

  it("rejects removed GO and cohort-dispatch routes before upstream", async () => {
    let hits = 0;
    const handler = makeHandler(async () => { hits += 1; return new Response("{}"); });
    for (const path of [
      `${HUMAN_GATE_PREFIX}/${COHORT}/decision`,
      `${HUMAN_GATE_PREFIX}/${COHORT}/dispatch`,
      `${HUMAN_GATE_PREFIX}/dispatch`,
    ]) {
      const res = await handler(request("POST", path, "admins,operators", { idempotency_key: "idem-old-route" }));
      assert.equal(res.status, 404, path);
    }
    assert.equal(hits, 0);
  });
});
