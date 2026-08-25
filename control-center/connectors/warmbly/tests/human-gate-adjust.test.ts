/**
 * The cohort `adjust` control-plane operation.
 *
 * Adjust mints a new immutable cohort version from edited copy and revokes the
 * authorization bound to the version it supersedes. It is the sixth and only
 * new member of the fixed human-gate allowlist; everything asserted here is
 * about keeping it exactly that narrow.
 *
 * No real mailbox, token or PII appears in this file. Hosts are `.invalid`,
 * hashes are obvious fixtures, and copy is neutral Portuguese.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADJUST_REFUSED_FIELDS,
  ADJUST_REQUEST_FIELDS,
} from "../src/human-gate/contract.ts";
import { createHumanGateHttpHandler, HUMAN_GATE_PREFIX } from "../src/human-gate/http.ts";
import { defaultOperatorIdentityPolicy } from "../src/operator/identity.ts";

const hop = "10.89.0.2";
const TOKEN = "wmbly_fixture_operator_credential";
const COHORT = "11111111-1111-4111-8111-111111111111";
const CANDIDATE = "22222222-2222-4222-8222-222222222222";
const ADJUST_PATH = `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}/adjust`;
const UPSTREAM_PATH = `/v1/confenge/cohorts/${COHORT}/candidates/${CANDIDATE}/adjust`;

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

function adjustBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subject: "Assunto revisado da versao congelada",
    body_text: "Corpo revisado, sem destinatario e sem link de envio.",
    reason: "ajuste de copy aprovado em revisao",
    confirmation: "v3",
    expected_frozen_hash: "sha256:frozen-fixture-before",
    idempotency_key: "idem-adjust-000001",
    ...extra,
  };
}

/** A 201 shaped exactly like the canonical contract, with fixture values only. */
function createdPayload(): Record<string, unknown> {
  return {
    contract_version: "confenge.human-gate.v1",
    cohort: { id: COHORT, version: 4, freshness: "FRESH", candidates: [] },
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
  };
}

function handlerWith(
  fetchImpl: typeof fetch,
  extra: { timeoutMs?: number; logger?: (entry: { level: "info" | "warn" | "error"; msg: string } & Record<string, unknown>) => void } = {},
) {
  return createHumanGateHttpHandler({
    baseUrl: "https://warmbly.invalid",
    token: TOKEN,
    identityPolicy: defaultOperatorIdentityPolicy([hop]),
    fetchImpl,
    ...extra,
  });
}

describe("human gate adjust — the request that reaches Warmbly", () => {
  it("forwards exactly the canonical fields to the exact upstream route", async () => {
    let seen: { url?: string; body?: Record<string, unknown>; headers?: Headers; method?: string } = {};
    const handler = handlerWith(async (input, init) => {
      seen = {
        url: String(input),
        method: init?.method,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        headers: new Headers(init?.headers),
      };
      return new Response(JSON.stringify(createdPayload()), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    const res = await handler(request("POST", ADJUST_PATH, "operators", adjustBody()));

    assert.equal(res.status, 201);
    assert.equal(seen.method, "POST");
    assert.equal(seen.url, `https://warmbly.invalid${UPSTREAM_PATH}`);
    // Exactly the five contract fields — no more, and the edge-only idempotency
    // key travels as a header rather than in the body.
    assert.deepEqual(Object.keys(seen.body ?? {}).sort(), [...ADJUST_REQUEST_FIELDS].sort());
    assert.equal(seen.headers?.get("idempotency-key"), "idem-adjust-000001");
    assert.match(String(seen.headers?.get("x-correlation-id")), /^cc:human-gate:/);
  });

  it("runs under operators, while approval reconciliation remains admins-only", async () => {
    let hits = 0;
    const handler = handlerWith(async () => {
      hits += 1;
      return new Response(JSON.stringify(createdPayload()), { status: 201 });
    });
    // One identity, operators only. Adjust is reachable for it; bulk approval
    // reconciliation is not. That difference is the whole RBAC claim.
    const ok = await handler(request("POST", ADJUST_PATH, "operators", adjustBody()));
    assert.equal(ok.status, 201, "operators must be sufficient for adjust");
    assert.equal(hits, 1);

    const denied = await handler(
      request("POST", `${HUMAN_GATE_PREFIX}/reconcile-approved`, "operators", {
        idempotency_key: "idem-reconcile-0002",
      }),
    );
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "insufficient_human_gate_role");
    assert.equal(denied.body.operation, "reconcile_approved");
    assert.equal(hits, 1, "a role refusal must never reach Warmbly");
  });

  it("refuses an identity whose groups carry no operator group at all", async () => {
    let hits = 0;
    const handler = handlerWith(async () => {
      hits += 1;
      return new Response("{}");
    });
    const res = await handler(request("POST", ADJUST_PATH, "viewers", adjustBody()));
    assert.equal(res.status, 401, "the identity layer refuses a non-operator group outright");
    assert.equal(res.body.operation, "adjust");
    assert.equal(res.body.outcome, "REFUSED");
    assert.equal(hits, 0);
  });

  it("refuses an unauthenticated caller before any socket is opened", async () => {
    let hits = 0;
    const handler = handlerWith(async () => {
      hits += 1;
      return new Response("{}");
    });
    const res = await handler({
      method: "POST",
      url: ADJUST_PATH,
      remoteAddress: hop,
      headers: {},
      body: adjustBody(),
    });
    assert.equal(res.status, 401);
    assert.equal(hits, 0);
    assert.equal(res.body.operation, "adjust");
    assert.equal(res.body.outcome, "REFUSED");
  });
});

describe("human gate adjust — the schema refuses, it does not ignore", () => {
  for (const field of ADJUST_REFUSED_FIELDS) {
    it(`rejects the extra property "${field}" instead of dropping it`, async () => {
      let hits = 0;
      const handler = handlerWith(async () => {
        hits += 1;
        return new Response(JSON.stringify(createdPayload()), { status: 201 });
      });
      const res = await handler(
        request("POST", ADJUST_PATH, "operators", adjustBody({ [field]: "fixture" })),
      );
      assert.equal(res.status, 422, `${field} must be a refusal, not a silent drop`);
      assert.equal(res.body.code, "unexpected_field");
      assert.deepEqual(res.body.rejected_fields, [field]);
      assert.equal(hits, 0, `${field} must never reach Warmbly`);
    });
  }

  it("names every unknown field at once rather than only the first", async () => {
    let hits = 0;
    const handler = handlerWith(async () => {
      hits += 1;
      return new Response("{}");
    });
    const res = await handler(
      request("POST", ADJUST_PATH, "operators", adjustBody({ mailbox: "x", route_class: "y" })),
    );
    assert.equal(res.status, 422);
    assert.deepEqual(res.body.rejected_fields, ["mailbox", "route_class"]);
    assert.equal(hits, 0);
  });

  for (const field of ADJUST_REQUEST_FIELDS) {
    it(`requires "${field}" to be present and non-empty`, async () => {
      let hits = 0;
      const handler = handlerWith(async () => {
        hits += 1;
        return new Response("{}");
      });
      const body = adjustBody();
      delete body[field];
      const res = await handler(request("POST", ADJUST_PATH, "operators", body));
      assert.equal(res.status, 422);
      assert.equal(res.body.code, "invalid_adjust_payload");
      assert.deepEqual(res.body.rejected_fields, [field]);
      assert.equal(hits, 0);
    });
  }

  it("requires a caller-stable idempotency key before it even looks at the copy", async () => {
    let hits = 0;
    const handler = handlerWith(async () => {
      hits += 1;
      return new Response("{}");
    });
    const body = adjustBody();
    delete body.idempotency_key;
    const res = await handler(request("POST", ADJUST_PATH, "operators", body));
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "idempotency_key_required");
    assert.equal(hits, 0);
  });
});

describe("human gate adjust — response fidelity", () => {
  it("surfaces receipt, correlation and the new version identity instead of a generic message", async () => {
    const handler = handlerWith(
      async () =>
        new Response(JSON.stringify(createdPayload()), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    const res = await handler(request("POST", ADJUST_PATH, "operators", adjustBody()));
    assert.equal(res.status, 201);
    assert.equal(res.body.operation, "adjust");
    assert.equal(res.body.outcome, "APPLIED");
    // The server's own receipt, not an edge placeholder.
    assert.equal(res.body.receipt, "adjust:r1");
    assert.match(String(res.body.edge_correlation_id), /^cc:human-gate:/);
    // The created resource is navigable: the cockpit can open the new version.
    assert.deepEqual(res.body.resource, {
      kind: "cohort",
      id: COHORT,
      version: 4,
      adjustment_id: "33333333-3333-4333-8333-333333333333",
      from_version: 3,
      to_version: 4,
    });
    // The full new-version cohort payload survives, undiluted.
    const adjustment = res.body.adjustment as Record<string, unknown>;
    assert.equal(adjustment.correlation_id, "wmbly:adjust:fixture");
    assert.equal(adjustment.revoked_authorization_id, "44444444-4444-4444-8444-444444444444");
    assert.deepEqual(adjustment.diff, [{ field: "subject", before: "antes", after: "depois" }]);
    assert.deepEqual(res.body.cohort, { id: COHORT, version: 4, freshness: "FRESH", candidates: [] });
    assert.equal(res.body.auto_send_enabled, false);
  });

  it("invents nothing when the server returned no resource identity", async () => {
    const handler = handlerWith(
      async () => new Response(JSON.stringify({ receipt: "review:r1" }), { status: 200 }),
    );
    const res = await handler(
      request(
        "POST",
        `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}/review`,
        "operators",
        { decision: "APPROVE", reason: "ok", acknowledged: true, idempotency_key: "idem-review-0001" },
      ),
    );
    assert.equal(res.body.operation, "review");
    assert.equal(res.body.outcome, "APPLIED");
    assert.equal(res.body.resource, undefined, "an absent identity must stay absent");
    assert.equal(res.body.receipt, "review:r1");
  });

  it("labels every one of the six writes with its own operation name", async () => {
    const handler = handlerWith(async () => new Response(JSON.stringify({ receipt: "r" }), { status: 200 }));
    const cases: [string, string, Record<string, unknown>, string][] = [
      ["POST", HUMAN_GATE_PREFIX, { limit: 2, idempotency_key: "idem-create-0001" }, "create"],
      ["POST", `${HUMAN_GATE_PREFIX}/${COHORT}/reproduce`, { idempotency_key: "idem-repro-0001" }, "reproduce"],
      ["POST", `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}/validation`, { idempotency_key: "idem-valid-0001" }, "validation"],
      ["POST", `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}/review`, { decision: "HOLD", reason: "x", idempotency_key: "idem-review-0002" }, "review"],
      ["POST", ADJUST_PATH, adjustBody(), "adjust"],
      ["GET", HUMAN_GATE_PREFIX, {}, "list_cohorts"],
    ];
    for (const [method, path, body, operation] of cases) {
      const res = await handler(request(method, path, "operators", body));
      assert.equal(res.body.operation, operation, `${method} ${path}`);
    }
    const reconcile = await handler(
      request("POST", `${HUMAN_GATE_PREFIX}/reconcile-approved`, "admins,operators", {
        idempotency_key: "idem-reconcile-0001",
      }),
    );
    assert.equal(reconcile.body.operation, "reconcile_approved");
  });

  it("preserves the server's own refusal codes for every adjust conflict", async () => {
    for (const [status, code] of [
      [409, "frozen_hash_mismatch"],
      [409, "confirmation_mismatch"],
      [409, "version_superseded"],
      [409, "authority_active"],
      [422, "immutable_field"],
      [422, "copy_qa_failed"],
      [404, "candidate_not_found"],
    ] as const) {
      let hits = 0;
      const handler = handlerWith(async () => {
        hits += 1;
        return new Response(JSON.stringify({ ok: false, code, reason: "fixture refusal" }), {
          status,
          headers: { "content-type": "application/json" },
        });
      });
      const res = await handler(request("POST", ADJUST_PATH, "operators", adjustBody()));
      assert.equal(res.status, status, code);
      assert.equal(res.body.code, code);
      assert.equal(res.body.outcome, "REFUSED", `${code} is a determinate refusal`);
      assert.equal(res.body.operation, "adjust");
      assert.equal(hits, 1, `${code} must never be retried by the edge`);
    }
  });
});

describe("human gate adjust — UNKNOWN is never reported as failure", () => {
  it("reports a write timeout as UNKNOWN, keeps the idempotency key and never retries", async () => {
    let hits = 0;
    const handler = handlerWith(async (_input, init) => {
      hits += 1;
      await new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      );
      return new Response("{}");
    }, { timeoutMs: 1 });
    const res = await handler(request("POST", ADJUST_PATH, "operators", adjustBody()));
    assert.equal(res.status, 503);
    assert.equal(res.body.code, "human_gate_transport_unknown");
    assert.equal(res.body.outcome, "UNKNOWN", "a timed-out write is indeterminate, not failed");
    assert.equal(res.body.operation, "adjust");
    // Retrying with the same key is safe; losing the key is what makes a retry
    // a second adjustment.
    assert.equal(res.body.idempotency_key, "idem-adjust-000001");
    assert.equal(hits, 1);
  });

  for (const status of [500, 502, 503, 504] as const) {
    it(`reports upstream ${status} on a write as UNKNOWN, not as a refusal`, async () => {
      let hits = 0;
      const handler = handlerWith(async () => {
        hits += 1;
        return new Response(JSON.stringify({ ok: false, code: "internal_error" }), {
          status,
          headers: { "content-type": "application/json" },
        });
      });
      const res = await handler(request("POST", ADJUST_PATH, "operators", adjustBody()));
      assert.equal(res.status, status);
      assert.equal(res.body.outcome, "UNKNOWN");
      assert.equal(res.body.code, "internal_error", "the server's code is preserved verbatim");
      assert.equal(res.body.idempotency_key, "idem-adjust-000001");
      assert.equal(hits, 1, "the edge must never retry an indeterminate write");
    });
  }

  it("keeps a 5xx read a refusal, because a read that failed changed nothing", async () => {
    const handler = handlerWith(
      async () => new Response(JSON.stringify({ ok: false, code: "internal_error" }), { status: 500 }),
    );
    const res = await handler(request("GET", HUMAN_GATE_PREFIX));
    assert.equal(res.body.outcome, "REFUSED");
    assert.equal(res.body.idempotency_key, undefined);
  });

  it("keeps a timed-out read a refusal and says no write was attempted", async () => {
    const handler = handlerWith(async (_input, init) => {
      await new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      );
      return new Response("{}");
    }, { timeoutMs: 1 });
    const res = await handler(request("GET", HUMAN_GATE_PREFIX));
    assert.equal(res.status, 503);
    assert.equal(res.body.code, "human_gate_read_unavailable");
    assert.equal(res.body.outcome, "REFUSED");
  });

  it("logs the adjust actor opaquely and leaks no identity into the log stream", async () => {
    const logs: unknown[] = [];
    const handler = handlerWith(
      async () => new Response(JSON.stringify(createdPayload()), { status: 201 }),
      { logger: (entry) => { logs.push(entry); } },
    );
    const res = await handler(request("POST", ADJUST_PATH, "operators", adjustBody()));
    assert.equal(res.status, 201);
    const serialized = JSON.stringify(logs);
    assert.match(serialized, /authelia:[a-f0-9]{16}/);
    assert.match(serialized, /"operation":"adjust"/);
    assert.doesNotMatch(serialized, /founder|@confenge\.invalid|Remote-/i);
    assert.doesNotMatch(serialized, new RegExp(TOKEN));
    // Neither the edited copy nor the frozen hash belongs in a log line.
    assert.doesNotMatch(serialized, /Assunto revisado|Corpo revisado/);
  });
});
