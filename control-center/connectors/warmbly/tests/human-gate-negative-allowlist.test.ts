/**
 * What the human gate must never be able to construct.
 *
 * The load-bearing property of this connector is negative: there is no generic
 * proxy route, and no route that can send, dispatch, queue, resume, auto-send or
 * charge. Adding `adjust` is the first widening of this surface in a while, so
 * these tests hold the boundary from the outside — by enumerating the routes an
 * attacker would want and proving each one is unreachable, at every prefix and
 * through every coercion that has worked on fixed-route proxies before.
 *
 * Every assertion also checks that `fetch` was never called: a 404 that still
 * touched Warmbly would not be a refusal.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FORBIDDEN_HUMAN_GATE_SEGMENTS,
  HUMAN_GATE_OPERATIONS,
  isCanonicalUuid,
} from "../src/human-gate/contract.ts";
import {
  createHumanGateHttpHandler,
  HUMAN_GATE_PREFIX,
  HUMAN_GATE_ROUTES,
} from "../src/human-gate/http.ts";
import { defaultOperatorIdentityPolicy } from "../src/operator/identity.ts";

const hop = "10.89.0.2";
const COHORT = "11111111-1111-4111-8111-111111111111";
const CANDIDATE = "22222222-2222-4222-8222-222222222222";

function request(method: string, url: string, groups = "admins,operators", body: unknown = {}) {
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

/** A handler that records every upstream attempt, so "refused" can be proven. */
function trap() {
  const attempts: string[] = [];
  const handler = createHumanGateHttpHandler({
    baseUrl: "https://warmbly.invalid",
    token: "wmbly_fixture_operator_credential",
    identityPolicy: defaultOperatorIdentityPolicy([hop]),
    fetchImpl: async (input) => {
      attempts.push(String(input));
      return new Response(JSON.stringify({ receipt: "should-never-happen" }), { status: 200 });
    },
  });
  return { attempts, handler };
}

const WRITE_BODY = {
  idempotency_key: "idem-negative-0001",
  reason: "fixture",
  confirmation: "v3",
  subject: "s",
  body_text: "b",
  expected_frozen_hash: "sha256:x",
};

describe("the human gate cannot construct an outbound-send route", () => {
  for (const segment of FORBIDDEN_HUMAN_GATE_SEGMENTS) {
    it(`refuses every shape of "${segment}"`, async () => {
      const { attempts, handler } = trap();
      const shapes = [
        `${HUMAN_GATE_PREFIX}/${segment}`,
        `${HUMAN_GATE_PREFIX}/${COHORT}/${segment}`,
        `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}/${segment}`,
        `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}/adjust/${segment}`,
        `${HUMAN_GATE_PREFIX}/${COHORT}/${segment}/candidates/${CANDIDATE}/adjust`,
        `/v1/warmbly/operator/${segment}`,
        `/v1/confenge/${segment}`,
      ];
      for (const shape of shapes) {
        for (const method of ["POST", "GET", "PUT", "PATCH", "DELETE"]) {
          const res = await handler(request(method, shape, "admins,operators", WRITE_BODY));
          assert.equal(res.status, 404, `${method} ${shape} must be outside the allowlist`);
          assert.equal(res.body.code, "human_gate_route_not_allowed");
        }
      }
      assert.deepEqual(attempts, [], `"${segment}" must never reach Warmbly`);
    });
  }

  it("has no generic proxy route: an arbitrary path is refused, not forwarded", async () => {
    const { attempts, handler } = trap();
    const arbitrary = [
      `${HUMAN_GATE_PREFIX}/anything`,
      `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}/anything`,
      "/v1/warmbly/operator/cohorts-proxy",
      "/v1/warmbly/operator/cohortsx",
      "/",
      "",
      `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}/adjust/confirm`,
    ];
    for (const path of arbitrary) {
      const res = await handler(request("POST", path, "admins,operators", WRITE_BODY));
      assert.equal(res.status, 404, path);
    }
    assert.deepEqual(attempts, []);
  });

  it("exposes no operation name outside the fixed vocabulary", () => {
    const declared = HUMAN_GATE_ROUTES.map((route) => route.operation);
    for (const operation of declared) {
      assert.ok(
        (HUMAN_GATE_OPERATIONS as readonly string[]).includes(operation),
        `${operation} is not a declared human-gate operation`,
      );
    }
    for (const forbidden of FORBIDDEN_HUMAN_GATE_SEGMENTS) {
      assert.ok(
        !(HUMAN_GATE_OPERATIONS as readonly string[]).includes(forbidden),
        `${forbidden} must never become an operation`,
      );
    }
    // Exactly the six writes plus dispatch, plus three reads.
    assert.deepEqual([...declared].sort(), [
      "adjust", "create", "decision", "dispatch", "list_cohorts", "read_candidate",
      "read_cohort", "reproduce", "review", "validation",
    ]);
  });
});

/**
 * `dispatch` is the only segment ever taken off the forbidden list, so it gets
 * the same adversarial treatment the list itself provides: reachable at exactly
 * one shape, by exactly one method, for exactly one role, and nowhere else.
 */
describe("dispatch is reachable at exactly one shape and nowhere else", () => {
  const only = `${HUMAN_GATE_PREFIX}/${COHORT}/dispatch`;

  it("forwards the cohort dispatch and nothing else about it", async () => {
    const { attempts, handler } = trap();
    const res = await handler(request("POST", only, "admins,operators", WRITE_BODY));
    assert.equal(res.status, 200);
    assert.deepEqual(attempts, [`https://warmbly.invalid/v1/confenge/cohorts/${COHORT}/dispatch`]);
  });

  it("has no candidate-level dispatch, and no dispatch at the bare prefix", async () => {
    const { attempts, handler } = trap();
    for (const path of [
      `${HUMAN_GATE_PREFIX}/dispatch`,
      `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}/dispatch`,
      `${HUMAN_GATE_PREFIX}/${COHORT}/dispatch/${CANDIDATE}`,
      `${HUMAN_GATE_PREFIX}/${COHORT}/dispatch/all`,
      `/v1/warmbly/operator/dispatch`,
      `/v1/confenge/dispatch`,
    ]) {
      const res = await handler(request("POST", path, "admins,operators", WRITE_BODY));
      assert.equal(res.status, 404, `${path} must be outside the allowlist`);
      assert.equal(res.body.code, "human_gate_route_not_allowed");
    }
    assert.deepEqual(attempts, [], "no dispatch shape but the one may reach Warmbly");
  });

  it("refuses every method on dispatch except POST", async () => {
    const { attempts, handler } = trap();
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const res = await handler(request(method, only, "admins,operators", WRITE_BODY));
      assert.equal(res.status, 404, method);
    }
    assert.deepEqual(attempts, []);
  });

  it("requires admins: operators alone cannot dispatch, and the refusal never reaches Warmbly", async () => {
    const { attempts, handler } = trap();
    const res = await handler(request("POST", only, "operators", WRITE_BODY));
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "insufficient_human_gate_role");
    assert.deepEqual(attempts, []);
  });

  it("refuses a dispatch whose cohort id is not a canonical UUID or tries to traverse", async () => {
    const { attempts, handler } = trap();
    for (const id of [
      "..",
      "../send",
      `${COHORT}%2F..%2Fsend`,
      "%2e%2e%2fqueue",
      "https://evil.invalid",
      "-".repeat(36),
      "all",
    ]) {
      const res = await handler(
        request("POST", `${HUMAN_GATE_PREFIX}/${id}/dispatch`, "admins,operators", WRITE_BODY),
      );
      assert.equal(res.status, 404, id);
    }
    assert.deepEqual(attempts, []);
  });

  it("still cannot reach send or queue, which is what dispatch is not", async () => {
    const { attempts, handler } = trap();
    for (const path of [
      `${HUMAN_GATE_PREFIX}/${COHORT}/send`,
      `${HUMAN_GATE_PREFIX}/${COHORT}/queue`,
      `${HUMAN_GATE_PREFIX}/${COHORT}/dispatch/send`,
      `${HUMAN_GATE_PREFIX}/${COHORT}/dispatch/queue`,
    ]) {
      const res = await handler(request("POST", path, "admins,operators", WRITE_BODY));
      assert.equal(res.status, 404, path);
    }
    assert.deepEqual(attempts, []);
  });

  it("drops a query string that tries to raise the batch beyond the upstream cap", async () => {
    const { attempts, handler } = trap();
    const res = await handler(
      request("POST", `${only}?limit=5000`, "admins,operators", WRITE_BODY),
    );
    assert.equal(res.status, 200);
    // Writes never carry `url.search` upstream, so the batch size is whatever
    // Warmbly decides — and Warmbly caps it at ten.
    assert.deepEqual(attempts, [`https://warmbly.invalid/v1/confenge/cohorts/${COHORT}/dispatch`]);
  });
});

describe("adjust cannot be coerced into another route by its identifiers", () => {
  it("refuses a cohort id that tries to traverse out of the cohort route", async () => {
    const { attempts, handler } = trap();
    const hostile = [
      "..",
      "../..",
      "../dispatch",
      `${COHORT}/../dispatch`,
      `..%2Fdispatch`,
      "%2e%2e%2fdispatch",
      "%2E%2E/queue",
      `${COHORT}%2F..%2Fsend`,
      "https:%2F%2Fevil.invalid%2Fv1%2Fconfenge%2Fsend",
      "..\\dispatch",
    ];
    for (const id of hostile) {
      for (const path of [
        `${HUMAN_GATE_PREFIX}/${id}/candidates/${CANDIDATE}/adjust`,
        `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${id}/adjust`,
      ]) {
        const res = await handler(request("POST", path, "admins,operators", WRITE_BODY));
        assert.equal(res.status, 404, `${path} must not match any allowlisted route`);
      }
    }
    assert.deepEqual(attempts, [], "a hostile identifier must never reach Warmbly");
  });

  it("refuses an absolute URL smuggled in as an identifier", async () => {
    const { attempts, handler } = trap();
    for (const id of [
      "https://evil.invalid",
      "http://169.254.169.254/latest/meta-data",
      "//evil.invalid",
      "https%3A%2F%2Fevil.invalid",
    ]) {
      const res = await handler(
        request("POST", `${HUMAN_GATE_PREFIX}/${id}/candidates/${CANDIDATE}/adjust`, "admins,operators", WRITE_BODY),
      );
      assert.equal(res.status, 404, id);
    }
    assert.deepEqual(attempts, []);
  });

  it("ignores an attacker-chosen host on the request line and always uses the configured base", async () => {
    const { attempts, handler } = trap();
    const res = await handler(
      request(
        "POST",
        `https://evil.invalid${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}/adjust`,
        "admins,operators",
        WRITE_BODY,
      ),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(attempts, [
      `https://warmbly.invalid/v1/confenge/cohorts/${COHORT}/candidates/${CANDIDATE}/adjust`,
    ]);
  });

  it("validates identifiers as canonical UUIDs before any URL is built", async () => {
    const { attempts, handler } = trap();
    const notUuids = [
      "-".repeat(36),
      "1111111111114111811111111111111z",
      "11111111-1111-4111-8111-11111111111",
      "11111111-1111-4111-8111-1111111111111",
      "11111111111141118111111111111111",
      "11111111-1111-4111-8111-111111111111 ",
      "*",
      "%00",
    ];
    for (const id of notUuids) {
      assert.equal(isCanonicalUuid(id), false, `${JSON.stringify(id)} is not a canonical UUID`);
      const res = await handler(
        request("POST", `${HUMAN_GATE_PREFIX}/${id}/candidates/${CANDIDATE}/adjust`, "admins,operators", WRITE_BODY),
      );
      assert.equal(res.status, 404, JSON.stringify(id));
    }
    assert.deepEqual(attempts, []);
    // The previous pattern, `[0-9a-fA-F-]{36}`, matched 36 hyphens. Pinned so a
    // loosening of the identifier pattern is a visible regression.
    assert.equal(/^[0-9a-fA-F-]{36}$/.test("-".repeat(36)), true);
    assert.equal(isCanonicalUuid("11111111-1111-4111-8111-111111111111"), true);
  });

  it("refuses every method on adjust except POST", async () => {
    const { attempts, handler } = trap();
    const path = `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}/adjust`;
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const res = await handler(request(method, path, "admins,operators", WRITE_BODY));
      assert.equal(res.status, 404, method);
    }
    assert.deepEqual(attempts, []);
  });

  it("does not let a query string move the write to another upstream route", async () => {
    const { attempts, handler } = trap();
    const res = await handler(
      request(
        "POST",
        `${HUMAN_GATE_PREFIX}/${COHORT}/candidates/${CANDIDATE}/adjust?redirect=/v1/confenge/dispatch/send`,
        "admins,operators",
        WRITE_BODY,
      ),
    );
    assert.equal(res.status, 200);
    // The query is dropped on writes: only GET carries `url.search` upstream.
    assert.deepEqual(attempts, [
      `https://warmbly.invalid/v1/confenge/cohorts/${COHORT}/candidates/${CANDIDATE}/adjust`,
    ]);
  });
});
