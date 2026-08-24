/**
 * The queue arithmetic, on its own.
 *
 * Everything here is what decides whether a message the reviewer just approved
 * can come back and be approved a second time, so it is pinned away from the
 * markup that renders it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_REVIEW_QUEUE_FILTER,
  REVIEW_QUEUE_FILTERS,
  markReviewDecided,
  resetReviewQueue,
  resolveReviewQueueFilter,
  reviewQueueCounts,
  reviewQueueFilterMatches,
  reviewQueueState,
  rollbackReviewDecided,
  serverReviewState,
} from "../src/review-queue";

const COHORT = "11111111-1111-4111-8111-111111111111";

function candidate(id: string, review: unknown): Record<string, unknown> {
  return { candidate_id: id, review };
}

test("pendentes is the operational default, and an unknown recorte falls back to it", () => {
  assert.equal(DEFAULT_REVIEW_QUEUE_FILTER, "pendentes");
  assert.equal(resolveReviewQueueFilter(null), "pendentes");
  assert.equal(resolveReviewQueueFilter("aprovadas"), "aprovadas");
  assert.equal(resolveReviewQueueFilter("qualquer-coisa"), "pendentes");
  assert.deepEqual([...REVIEW_QUEUE_FILTERS], ["pendentes", "aprovadas", "ajuste", "todas"]);
});

test("the server's own verdict decides the state, and an invalidated APPROVE is work again", () => {
  assert.equal(serverReviewState(candidate("a", null)), "pendente");
  assert.equal(serverReviewState(candidate("a", {})), "pendente");
  assert.equal(serverReviewState(candidate("a", { decision: "APPROVE" })), "aprovado");
  assert.equal(serverReviewState(candidate("a", { decision: "APPROVE", effective: true })), "aprovado");
  // Drift under an approval — recipient, copy, policy or evidence moved — puts
  // the message back in front of the reviewer instead of hiding it as done.
  assert.equal(serverReviewState(candidate("a", { decision: "APPROVE", effective: false })), "pendente");
  assert.equal(serverReviewState(candidate("a", { decision: "HOLD", effective: false })), "ajuste");
  assert.equal(serverReviewState(candidate("a", { decision: "REJECT" })), "ajuste");
});

test("todas matches everything and each other recorte matches exactly one state", () => {
  for (const state of ["pendente", "aprovado", "ajuste"] as const) {
    assert.equal(reviewQueueFilterMatches("todas", state), true);
  }
  assert.equal(reviewQueueFilterMatches("pendentes", "pendente"), true);
  assert.equal(reviewQueueFilterMatches("pendentes", "aprovado"), false);
  assert.equal(reviewQueueFilterMatches("aprovadas", "aprovado"), true);
  assert.equal(reviewQueueFilterMatches("ajuste", "ajuste"), true);
  assert.equal(reviewQueueFilterMatches("ajuste", "pendente"), false);
});

test("a local mark wins over a payload that has not caught up, until it is rolled back", () => {
  resetReviewQueue();
  const row = candidate("c1", null);
  assert.deepEqual(reviewQueueState(COHORT, row), { state: "pendente", optimistic: false });

  markReviewDecided(COHORT, "c1", "aprovado");
  assert.deepEqual(reviewQueueState(COHORT, row), { state: "aprovado", optimistic: true });

  // The server catching up is not a change of state, only of provenance.
  const confirmed = candidate("c1", { decision: "APPROVE", effective: true });
  assert.deepEqual(reviewQueueState(COHORT, confirmed), { state: "aprovado", optimistic: false });

  rollbackReviewDecided(COHORT, "c1");
  assert.deepEqual(reviewQueueState(COHORT, row), { state: "pendente", optimistic: false });
});

test("a local mark belongs to one version and one candidate and leaks into neither", () => {
  resetReviewQueue();
  markReviewDecided(COHORT, "c1", "aprovado");
  assert.equal(reviewQueueState(COHORT, candidate("c2", null)).state, "pendente");
  assert.equal(reviewQueueState("outra-versao", candidate("c1", null)).state, "pendente");
  resetReviewQueue();
});

test("an empty id never mints a mark that would match every candidate", () => {
  resetReviewQueue();
  markReviewDecided(COHORT, "", "aprovado");
  markReviewDecided("", "c1", "aprovado");
  assert.equal(reviewQueueState(COHORT, candidate("c1", null)).state, "pendente");
  assert.equal(reviewQueueState(COHORT, { review: null }).state, "pendente");
});

test("the counts are of this version's candidates and add up to the total", () => {
  resetReviewQueue();
  const rows = [
    candidate("c1", null),
    candidate("c2", { decision: "APPROVE" }),
    candidate("c3", { decision: "HOLD" }),
    candidate("c4", { decision: "APPROVE", effective: false }),
  ];
  const counts = reviewQueueCounts(COHORT, rows);
  assert.deepEqual(counts, { pendentes: 2, aprovadas: 1, ajuste: 1, total: 4 });
  assert.equal(counts.pendentes + counts.aprovadas + counts.ajuste, counts.total);

  markReviewDecided(COHORT, "c1", "aprovado");
  assert.deepEqual(reviewQueueCounts(COHORT, rows), {
    pendentes: 1,
    aprovadas: 2,
    ajuste: 1,
    total: 4,
  });
  resetReviewQueue();
});

test("fifty pending candidates stay fifty pending candidates, and approving drains them one by one", () => {
  resetReviewQueue();
  const rows = Array.from({ length: 50 }, (_, index) => candidate(`c${index}`, null));
  assert.equal(reviewQueueCounts(COHORT, rows).pendentes, 50);
  for (let index = 0; index < 18; index += 1) markReviewDecided(COHORT, `c${index}`, "aprovado");
  const counts = reviewQueueCounts(COHORT, rows);
  assert.deepEqual(counts, { pendentes: 32, aprovadas: 18, ajuste: 0, total: 50 });
  const pending = rows.filter((row) =>
    reviewQueueFilterMatches("pendentes", reviewQueueState(COHORT, row).state),
  );
  assert.equal(pending.length, 32);
  assert.equal(pending[0]!.candidate_id, "c18", "the next pending one takes the first position");
  resetReviewQueue();
});
