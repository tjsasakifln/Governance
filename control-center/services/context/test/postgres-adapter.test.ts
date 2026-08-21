import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { startTestPostgres } from "../../../persistence/tests/helpers/postgres.ts";
import { AGENT, FOUNDER, createInput, NOW } from "./helpers.ts";
import { frozenClock } from "../src/clock.ts";
import { sequentialIds } from "../src/ids.ts";
import { silentLogger } from "../src/log.ts";
import { createContextService } from "../src/service.ts";
import { createPostgresStoreFromPool } from "../src/store/postgres.ts";
import type { PersistencePort } from "../src/store/adapter.ts";

function makeService(store: PersistencePort) {
  return createContextService({
    store,
    clock: frozenClock(NOW),
    ids: sequentialIds("pg"),
    founderActorId: FOUNDER.id,
    logger: silentLogger,
    defaultScope: "company",
    repoDomains: {},
  });
}

describe("postgres adapter", { concurrency: 1 }, () => {
test("postgres adapter round-trips a directive with provenance and rejects silent agent mutation", async () => {
  const pg = await startTestPostgres();
  try {
    const store = await createPostgresStoreFromPool(pg.pool);
    const service = makeService(store);
    const created = service.createDirective(
      FOUNDER,
      createInput("decision", "Ship Control Center on canonical ontology", {
        freshness_status: "FRESH",
        observed_at: NOW,
        confidence: 0.91,
      }),
    );
    await service.flush();
    assert.equal(created.kind, "decision");
    assert.equal(created.provenance.source.system, "manual");
    assert.equal(created.provenance.observed_at.endsWith("Z"), true);
    assert.equal(created.provenance.freshness_status, "FRESH");
    assert.equal(created.provenance.confidence, 0.91);

    const store2 = await createPostgresStoreFromPool(pg.pool);
    const service2 = makeService(store2);
    const roundTrip = service2.getDirective(FOUNDER, created.id);
    assert.equal(roundTrip.title, created.title);
    assert.equal(roundTrip.provenance.freshness_status, "FRESH");
    assert.equal(roundTrip.provenance.confidence, 0.91);

    const before = service2.getContext(FOUNDER, "company");
    assert.throws(() => service2.createDirective(AGENT, createInput("decision", "agent overwrite")));
    const after = service2.getContext(FOUNDER, "company");
    assert.equal(after.decisions.length, before.decisions.length);
    assert.equal(after.decisions[0]?.id, created.id);
    assert.ok(["FRESH", "STALE", "UNKNOWN", "ERROR"].includes(after.freshness_status));

    const reported = service2.recordAgentActivity(AGENT, {
      scope: "company",
      summary: "session complete",
      outcome: "completed",
      session_id: "sess-1",
    });
    await service2.flush();
    assert.equal(reported.kind, "session_result");
    const listed = service2.listAgentActivities(FOUNDER, "company");
    assert.equal(listed.some((row) => row.correlation_id === "sess-1"), true);
  } finally {
    await pg.stop();
  }
});

});
