import assert from "node:assert/strict";
import { test } from "node:test";
import { collectFromWarmblyPayload } from "@confenge/control-center-warmbly-connector";
import { projectCollector } from "../../../connectors/runner/src/projectors/project.ts";
import { loadFixture } from "../../../connectors/warmbly/tests/helpers.ts";
import { frozenClock } from "../src/clock.ts";
import { createFixtureOperationalPort } from "../src/operational/fixture.ts";
import { createOperationalService } from "../src/operational/service.ts";
import type { OperationalSnapshotRow } from "../src/operational/types.ts";
import { REPRESENTATIVE_REPO_DOMAINS } from "../src/representative.ts";
import { FOUNDER, NOW } from "./helpers.ts";

const OBSERVED_AT = "2026-08-20T11:50:00.000Z";

function commercialRow(payload: Record<string, unknown>): OperationalSnapshotRow {
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: OBSERVED_AT,
    source: { system: "warmbly", kind: "crm-read-model", locator: "commercial/pipeline" },
    confidence: 0.9,
    payload,
  }).find((row) => row.snapshot_kind === "commercial");
  assert.ok(projected);
  return {
    id: "cc:operational-snapshot:absence",
    scope: projected.scope,
    snapshot_kind: projected.snapshot_kind,
    generated_at: projected.observed_at,
    source: projected.source,
    observed_at: projected.observed_at,
    freshness_status: projected.freshness_status,
    confidence: projected.confidence,
    // The runner persists JSON: keys the mapper omitted must stay omitted.
    payload: JSON.parse(JSON.stringify(projected.payload)) as Record<string, unknown>,
  };
}

async function commercialSnapshot(row: OperationalSnapshotRow): Promise<Record<string, unknown>> {
  const operational = createOperationalService({
    port: createFixtureOperationalPort({ operational_snapshots: [row] }),
    clock: frozenClock(NOW),
    founderActorId: FOUNDER.id,
    repoDomains: REPRESENTATIVE_REPO_DOMAINS,
  });
  const domain = await operational.getDomain(FOUNDER, "commercial", "commercial");
  const slot = domain.snapshot as unknown as { presence: string; snapshot: Record<string, unknown> | null } | undefined;
  assert.ok(slot);
  assert.equal(slot.presence, "present");
  assert.ok(slot.snapshot);
  assert.equal(slot.snapshot.schema_version, "control-center.commercial-snapshot.v1");
  return slot.snapshot;
}

test("context assembles absent Warmbly counts as absent, never as 0", async () => {
  const payload = loadFixture("commercial-runtime.json");
  payload.unibox_overview = undefined;
  payload.confenge_inbound = undefined;
  payload.unavailable = [
    ...(payload.unavailable ?? []),
    { method: "GET", path: "/v1/confenge/inbound", status: 500, reason: "Warmbly returned 500" },
  ];
  const mapped = collectFromWarmblyPayload(payload, { now: new Date(OBSERVED_AT) });
  assert.equal("inbox_unread" in mapped.counts, false);
  assert.equal("inbound_now" in mapped.counts, false);

  const snapshot = await commercialSnapshot(commercialRow(mapped as unknown as Record<string, unknown>));
  const funnel = (snapshot.funnel ?? {}) as Record<string, unknown>;
  assert.equal("new_leads" in funnel, false);
  assert.notEqual(funnel.new_leads, 0);
  assert.equal(snapshot.inbound_unread_count, undefined);
  assert.notEqual(snapshot.inbound_unread_count, 0);
  const overview = ((snapshot.operations as Record<string, unknown> | undefined)?.overview ?? {}) as Record<
    string,
    unknown
  >;
  assert.equal(overview.inbound_requiring_attention, undefined);
  assert.notEqual(overview.inbound_requiring_attention, 0);
});

test("context keeps a real zero when the Warmbly surface answered an empty list", async () => {
  const payload = loadFixture("commercial-runtime.json");
  payload.confenge_inbound = [];
  payload.unibox_overview = { unread: 0, awaiting_reply: 0 };
  const mapped = collectFromWarmblyPayload(payload, { now: new Date(OBSERVED_AT) });
  assert.equal(mapped.counts.inbound_now, 0);
  assert.equal(mapped.counts.inbox_unread, 0);

  const snapshot = await commercialSnapshot(commercialRow(mapped as unknown as Record<string, unknown>));
  const funnel = (snapshot.funnel ?? {}) as Record<string, unknown>;
  assert.equal(funnel.new_leads, 0);
  assert.equal(snapshot.inbound_unread_count, 0);
  const overview = ((snapshot.operations as Record<string, unknown>).overview ?? {}) as Record<string, unknown>;
  assert.equal(overview.inbound_requiring_attention, 0);
});
