/**
 * Fresh consumer of the shipped package. Not the test file.
 * Loads the ledger, queries the fixture UTC day, and asserts founder-facing content.
 */
import assert from "node:assert/strict";
import {
  createAgentLedger,
  DONE_CORRELATION,
  FIXTURE_AGENT,
  FIXTURE_DAY,
  PARTIAL_CORRELATION,
  PARTIAL_EVIDENCE,
  PARTIAL_RESIDUAL,
  PARTIAL_SUMMARY,
  frozenClock,
  seedSyntheticDay,
  serializeCanonical,
  type TimelineItem,
} from "../src/index.js";

const clock = frozenClock(new Date("2026-08-20T16:00:00.000Z"));
const ledger = createAgentLedger({ now: clock });
seedSyntheticDay(ledger);

const timeline = ledger.timeline({ date: FIXTURE_DAY });
const last = ledger.lastActivity({ date: FIXTURE_DAY });

assert.ok(timeline.length >= 1, "timeline must name at least one session");
const named = timeline.find((item) => item.agent.id === FIXTURE_AGENT.id);
assert.ok(named, "timeline must name the fixture agent");
assert.ok(
  timeline.some((item) => item.correlation_id === PARTIAL_CORRELATION),
  "timeline must include the leftover session",
);

const leftover = timeline.find((item) => item.correlation_id === PARTIAL_CORRELATION);
assert.ok(leftover);
assertContent(leftover);
assert.equal(leftover.summary, PARTIAL_SUMMARY);
assert.ok(leftover.evidence.includes(PARTIAL_EVIDENCE[0] ?? ""));
assert.ok(leftover.residual_work.includes(PARTIAL_RESIDUAL[0] ?? ""));
assert.equal(leftover.status, "PARTIAL");

assert.ok(last);
assert.equal(last.correlation_id, DONE_CORRELATION);
assert.notEqual(last.correlation_id, PARTIAL_CORRELATION);

const payload = {
  day: FIXTURE_DAY,
  agent: named.agent,
  leftover: {
    correlation_id: leftover.correlation_id,
    summary: leftover.summary,
    evidence: leftover.evidence,
    residual_work: leftover.residual_work,
    status: leftover.status,
  },
  last_activity: {
    correlation_id: last.correlation_id,
    summary: last.summary,
    evidence: last.evidence,
    residual_work: last.residual_work,
  },
  timeline: timeline.map((item) => ({
    correlation_id: item.correlation_id,
    agent: item.agent.id,
    status: item.status,
    summary: item.summary,
    evidence: item.evidence,
    residual_work: item.residual_work,
  })),
};

process.stdout.write(`${serializeCanonical(payload)}\n`);
process.stdout.write("CONSUMER_OK\n");

function assertContent(item: TimelineItem): void {
  assert.ok(item.summary.length > 0, "summary must be present");
  assert.ok(Array.isArray(item.evidence), "evidence must be an explicit array");
  assert.ok(item.evidence.length > 0, "leftover item must include non-empty evidence");
  assert.ok(Array.isArray(item.residual_work), "residual_work must be an explicit array");
  assert.ok(item.residual_work.length > 0, "leftover item must include residual_work");
}
