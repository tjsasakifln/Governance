import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createPersistence } from "../../../persistence/src/index.js";
import { startIsolatedTestPostgres } from "../../../persistence/tests/helpers/postgres.ts";
import { frozenClock } from "../src/clock.ts";
import { createRequestListener } from "../src/http.ts";
import { silentLogger } from "../src/log.ts";
import { createPostgresOperationalPortFromPool } from "../src/operational/postgres.ts";
import { OPERATIONAL_VIEWS } from "../src/operational/types.ts";
import { createOperationalService } from "../src/operational/service.ts";
import { REPRESENTATIVE_REPO_DOMAINS } from "../src/representative.ts";
import { createPostgresStoreFromPool } from "../src/store/postgres.ts";
import { FOUNDER, makeService } from "./helpers.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("production operational reads map Goal 03 view columns and never invent FRESH", async () => {
  const src = readFileSync(join(here, "../src/operational/postgres.ts"), "utf8");
  const types = readFileSync(join(here, "../src/operational/types.ts"), "utf8");
  const boot = readFileSync(join(here, "../../../scripts/boot-production-context.ts"), "utf8");
  const harness = readFileSync(join(here, "../../../tests/convergence/live-runtime/harness.ts"), "utf8");
  assert.match(src, /OPERATIONAL_VIEWS\.collectorRuns/);
  assert.match(src, /OPERATIONAL_VIEWS\.sourceObservations/);
  assert.match(src, /OPERATIONAL_VIEWS\.operationalSnapshots/);
  assert.match(types, /control_center\.v_latest_collector_runs/);
  assert.match(types, /control_center\.v_latest_source_observations/);
  assert.match(types, /control_center\.v_latest_operational_snapshots/);
  assert.match(boot, /createPostgresOperationalPortFromPool/);
  assert.match(boot, /operational,/);
  assert.match(harness, /createPostgresOperationalPortFromPool/);
  assert.match(harness, /operational,/);
  assert.equal(OPERATIONAL_VIEWS.collectorRuns, "control_center.v_latest_collector_runs");
  assert.equal(OPERATIONAL_VIEWS.sourceObservations, "control_center.v_latest_source_observations");
  assert.equal(OPERATIONAL_VIEWS.operationalSnapshots, "control_center.v_latest_operational_snapshots");

  const pg = await startIsolatedTestPostgres();
  try {
    await createPostgresStoreFromPool(pg.pool);
    const port = createPostgresOperationalPortFromPool(pg.pool);
    const empty = await port.readLatest();
    assert.equal(empty.collector_runs.length, 0);
    assert.equal(empty.source_observations.length, 0);
    assert.equal(empty.operational_snapshots.length, 0);
    assert.equal(
      empty.operational_snapshots.some((row) => row.freshness_status === "FRESH"),
      false,
    );

    const persistence = createPersistence(pg.pool);
    await persistence.recordSnapshot({
      scope: "commercial",
      snapshotKind: "commercial",
      payload: { schema_version: "control-center.commercial-snapshot.v1", funnel: { new_leads: 2 } },
      source: { system: "warmbly", kind: "crm-read-model", locator: "commercial/pipeline" },
      observedAt: new Date("2026-08-20T11:50:00.000Z"),
      freshnessStatus: "STALE",
      confidence: 0.4,
    });
    await persistence.startCollectorRun({
      collectorName: "warmbly-commercial",
      scope: "commercial",
      source: { system: "warmbly", kind: "crm-read-model", locator: "commercial/pipeline" },
      observedAt: new Date("2026-08-20T11:49:00.000Z"),
      freshnessStatus: "STALE",
      confidence: 0.4,
      idempotencyKey: "warmbly:commercial:2026-08-20T11:50:00.000Z",
    });
    const latest = await port.readLatest();
    assert.equal(latest.operational_snapshots.length, 1);
    assert.equal(latest.operational_snapshots[0]?.snapshot_kind, "commercial");
    assert.equal(latest.operational_snapshots[0]?.freshness_status, "STALE");
    assert.notEqual(latest.operational_snapshots[0]?.freshness_status, "FRESH");
    assert.equal((latest.operational_snapshots[0]?.payload as { funnel?: { new_leads?: number } }).funnel?.new_leads, 2);
    assert.equal(latest.collector_runs.length, 1);
    assert.equal(latest.collector_runs[0]?.collector_name, "warmbly-commercial");
    assert.equal(latest.collector_runs[0]?.status, "started");
    assert.equal(latest.collector_runs[0]?.freshness_status, "STALE");

    const { service } = makeService();
    const operational = createOperationalService({
      port,
      clock: frozenClock("2026-08-20T12:00:00.000Z"),
      founderActorId: FOUNDER.id,
      repoDomains: REPRESENTATIVE_REPO_DOMAINS,
    });
    const server = createServer(
      createRequestListener({ service, operational, logger: silentLogger }),
    );
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/v1/attention?scope=company&horizon=now`, {
        headers: { "x-actor-id": FOUNDER.id, "x-actor-kind": FOUNDER.kind },
      });
      assert.notEqual(res.status, 404);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { freshness_status?: string };
      assert.notEqual(body.freshness_status, "FRESH");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  } finally {
    await pg.stop();
  }
});
