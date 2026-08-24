/**
 * Cross-repo contract pin for the cohort `adjust` operation.
 *
 * The canonical contract is `confenge.human-gate.v1`, owned by Warmbly. This
 * file deliberately does NOT copy Warmbly's schema document into Governance —
 * a second source of truth is exactly how the two drift while both look green.
 * Instead it pins the slice this connector actually depends on: the upstream
 * route it builds, the request fields it puts on the wire, the response fields
 * it reads back, and the refusal vocabulary it forwards unchanged.
 *
 * Change any of those and this test fails, which is the signal to go and agree
 * the change with the Warmbly side rather than ship a silent divergence.
 *
 * When `WARMBLY_REPO` points at a checkout, the pin is additionally cross-checked
 * against the backend source: the route literal and every request/response field
 * name must be present there. That reads the authority; it never copies it.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ADJUSTMENT_FIELDS,
  ADJUST_EDGE_ONLY_FIELDS,
  ADJUST_ERROR_CODES,
  ADJUST_REFUSED_FIELDS,
  ADJUST_REQUEST_FIELDS,
  ADJUST_RESPONSE_FIELDS,
  HUMAN_GATE_CONTRACT,
  HUMAN_GATE_OPERATIONS,
  HUMAN_GATE_OUTCOMES,
  HUMAN_GATE_WRITE_OPERATIONS,
  WARMBLY_COHORTS_PREFIX,
  validateAdjustRequest,
} from "../src/human-gate/contract.ts";
import { HUMAN_GATE_ROUTES } from "../src/human-gate/http.ts";

/** The one route template the backend and this connector must agree on. */
const ADJUST_UPSTREAM_TEMPLATE = `${WARMBLY_COHORTS_PREFIX}/{id}/candidates/{candidateId}/adjust`;

test("adjust is pinned to the canonical contract by name and version", () => {
  assert.equal(HUMAN_GATE_CONTRACT, "confenge.human-gate.v1");
  assert.equal(WARMBLY_COHORTS_PREFIX, "/v1/confenge/cohorts");
  assert.equal(ADJUST_UPSTREAM_TEMPLATE, "/v1/confenge/cohorts/{id}/candidates/{candidateId}/adjust");
});

test("adjust is one POST route under the operators role and nothing else", () => {
  const adjust = HUMAN_GATE_ROUTES.filter((route) => route.operation === "adjust");
  assert.equal(adjust.length, 1, "adjust must have exactly one route");
  assert.equal(adjust[0]?.method, "POST");
  assert.equal(
    adjust[0]?.role,
    "operators",
    "adjust carries the same permission as review, never the admins-only GO permission",
  );
  const decision = HUMAN_GATE_ROUTES.find((route) => route.operation === "decision");
  assert.equal(decision?.role, "admins", "the GO decision stays admins-only");
  assert.deepEqual(
    HUMAN_GATE_ROUTES.filter((r) => r.method === "POST").map((r) => r.operation).sort(),
    [...HUMAN_GATE_WRITE_OPERATIONS].sort(),
    "the write surface is exactly the seven declared operations",
  );
  assert.equal(HUMAN_GATE_OPERATIONS.length, 10, "three reads plus seven writes; nothing else exists");
  // Dispatch hands a GO'd cohort to Warmbly's queue, so it carries the same
  // authority as the GO it depends on and never the reviewer's.
  const dispatch = HUMAN_GATE_ROUTES.filter((route) => route.operation === "dispatch");
  assert.equal(dispatch.length, 1, "dispatch must have exactly one route");
  assert.equal(dispatch[0]?.method, "POST");
  assert.equal(dispatch[0]?.role, "admins", "dispatch is admins-only, like GO");
});

test("the adjust request shape is exactly the five contract fields", () => {
  assert.deepEqual([...ADJUST_REQUEST_FIELDS], [
    "subject",
    "body_text",
    "reason",
    "confirmation",
    "expected_frozen_hash",
  ]);
  assert.deepEqual([...ADJUST_EDGE_ONLY_FIELDS], ["idempotency_key"]);
  // No refused field may quietly become an accepted one.
  for (const field of ADJUST_REFUSED_FIELDS) {
    assert.ok(
      !(ADJUST_REQUEST_FIELDS as readonly string[]).includes(field),
      `${field} must never join the adjust request`,
    );
    const verdict = validateAdjustRequest({
      subject: "s", body_text: "b", reason: "r", confirmation: "v1",
      expected_frozen_hash: "sha256:x", [field]: "fixture",
    });
    assert.equal(verdict.ok, false, `${field} must be refused by the schema itself`);
    assert.equal(verdict.ok === false && verdict.code, "unexpected_field");
  }
  const accepted = validateAdjustRequest({
    subject: "s", body_text: "b", reason: "r", confirmation: "v1",
    expected_frozen_hash: "sha256:x", idempotency_key: "idem-contract-0001",
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(
    accepted.ok === true ? Object.keys(accepted.value).sort() : [],
    [...ADJUST_REQUEST_FIELDS].sort(),
    "the edge-only idempotency key is never forwarded in the body",
  );
});

test("the adjust 201 shape is exactly what the connector reads back", () => {
  assert.deepEqual([...ADJUST_RESPONSE_FIELDS], ["contract_version", "cohort", "adjustment"]);
  assert.deepEqual([...ADJUSTMENT_FIELDS], [
    "id",
    "cohort_id",
    "from_version",
    "to_version",
    "candidate_id",
    "before_content_hash",
    "after_content_hash",
    "before_frozen_hash",
    "after_frozen_hash",
    "diff",
    "revoked_authorization_id",
    "actor_id",
    "correlation_id",
    "receipt",
    "created_at",
  ]);
  // The two fields the cockpit navigates by, and the two it audits by.
  for (const required of ["to_version", "receipt", "correlation_id", "revoked_authorization_id"]) {
    assert.ok((ADJUSTMENT_FIELDS as readonly string[]).includes(required));
  }
});

test("the adjust refusal vocabulary and its statuses are pinned", () => {
  assert.deepEqual(ADJUST_ERROR_CODES, {
    frozen_hash_mismatch: 409,
    confirmation_mismatch: 409,
    version_superseded: 409,
    authority_active: 409,
    immutable_field: 422,
    copy_qa_failed: 422,
    candidate_not_found: 404,
  });
  assert.deepEqual([...HUMAN_GATE_OUTCOMES], ["APPLIED", "REFUSED", "UNKNOWN"]);
});

/** Walk a checkout for source files, so the probe does not hard-code a layout. */
function sourceText(root: string, limit = 4000): string {
  const chunks: string[] = [];
  let seen = 0;
  const walk = (dir: string): void => {
    if (seen > limit) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen > limit) return;
      if (entry === "node_modules" || entry === ".git" || entry === "vendor") continue;
      const full = join(dir, entry);
      let info;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        walk(full);
      } else if (/\.(go|ts|json|md|ya?ml|sql)$/.test(entry) && info.size < 2_000_000) {
        seen += 1;
        try {
          chunks.push(readFileSync(full, "utf8"));
        } catch {
          /* unreadable file is not a drift signal */
        }
      }
    }
  };
  walk(root);
  return chunks.join("\n");
}

test("the Warmbly checkout, when present, still declares the adjust route and its fields", (t) => {
  const repo = process.env.WARMBLY_REPO;
  if (!repo) {
    t.skip("WARMBLY_REPO not set; the connector-side pin still guards this repo's half");
    return;
  }
  const text = sourceText(repo);
  assert.match(text, /cohorts\/[^"'`\s]*candidates\/[^"'`\s]*adjust/, "backend no longer declares the adjust route");
  for (const field of [...ADJUST_REQUEST_FIELDS, ...ADJUSTMENT_FIELDS]) {
    assert.ok(text.includes(field), `backend no longer mentions the adjust field "${field}"`);
  }
  for (const code of Object.keys(ADJUST_ERROR_CODES)) {
    assert.ok(text.includes(code), `backend no longer emits the refusal code "${code}"`);
  }
});
