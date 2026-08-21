import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  HEALTH_DELTAS,
  createClientOps,
  scoreAccountHealth,
  serializeCanonical,
} from "../src/index.js";
import { FIXED_NOW, norteEngenhariaPayload, sulConsultoriaPayload } from "./fixtures.js";

describe("explainable health score", () => {
  test("same inputs produce the same score and reason set; reasons cite overdue, blocker, risk", () => {
    const ops = createClientOps({ now: FIXED_NOW });
    const norte = ops.ingest(norteEngenhariaPayload());

    const first = scoreAccountHealth(
      {
        commitments: norte.commitments,
        blockers: norte.blockers,
        risk: norte.risk,
        deliverables: norte.deliverables,
      },
      FIXED_NOW,
    );
    const second = scoreAccountHealth(
      {
        commitments: norte.commitments,
        blockers: norte.blockers,
        risk: norte.risk,
        deliverables: norte.deliverables,
      },
      FIXED_NOW,
    );

    assert.equal(serializeCanonical(first), serializeCanonical(second));
    assert.equal(first.score, norte.health.score);
    assert.equal(serializeCanonical(first.reasons), serializeCanonical(norte.health.reasons));

    const overdue = first.reasons.find((reason) => reason.code === "overdue_commitment");
    assert.ok(overdue);
    assert.equal(overdue.related_id, "c-relatorio-mensal");
    assert.match(overdue.message, /vencido/i);
    assert.equal(overdue.delta, HEALTH_DELTAS.overdue_commitment);

    const blocker = first.reasons.find((reason) => reason.code === "open_blocker");
    assert.ok(blocker);
    assert.equal(blocker.related_id, "b-acesso-homolog");
    assert.match(blocker.message, /bloqueio/i);
    assert.equal(blocker.delta, HEALTH_DELTAS.open_blocker);

    const risk = first.reasons.find((reason) => reason.code === "open_risk");
    assert.ok(risk);
    assert.equal(risk.related_id, "r-escopo");
    assert.match(risk.message, /risco/i);
    assert.equal(risk.delta, HEALTH_DELTAS.risk.medium);

    const blocked = first.reasons.find((reason) => reason.code === "blocked_deliverable");
    assert.ok(blocked);
    assert.equal(blocked.related_id, "d-relatorio");

    const blob = serializeCanonical(first);
    assert.doesNotMatch(blob, /ml|machine[- ]?learning|model-score|opaque/i);
    assert.equal(first.provenance.source, "derived:health-score");

    const expected =
      100 -
      HEALTH_DELTAS.overdue_commitment -
      HEALTH_DELTAS.open_blocker -
      HEALTH_DELTAS.risk.medium -
      HEALTH_DELTAS.blocked_deliverable;
    assert.equal(first.score, expected);
  });

  test("healthy client with no due/blocker/risk scores 100 with empty reasons", () => {
    const ops = createClientOps({ now: FIXED_NOW });
    const sul = ops.ingest(sulConsultoriaPayload());
    const health = scoreAccountHealth(
      {
        commitments: sul.commitments,
        blockers: sul.blockers,
        risk: sul.risk,
        deliverables: sul.deliverables,
      },
      FIXED_NOW,
    );
    assert.equal(health.score, 100);
    assert.equal(health.band, "healthy");
    assert.equal(health.reasons.length, 0);
    assert.equal(sul.client_slug, "sul-consultoria");
  });
});
