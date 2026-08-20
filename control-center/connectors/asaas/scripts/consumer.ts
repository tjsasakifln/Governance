/**
 * Fresh consumer of the shipped package. Not the assertion suite.
 * Loads representative fixtures twice through collectFinanceSnapshot.
 * Never calls live Asaas — even if ASAAS_API_KEY is present in the process env.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  collectFinanceSnapshot,
  createFixtureTransport,
  loadWebhookEvents,
  parseAsaasConfig,
  RecordingTransport,
  snapshotStableView,
} from "../src/index.js";

const NOW = new Date("2026-08-20T15:00:00.000Z");
const OUT_DIR = process.argv[2] ?? join(process.cwd(), "consumer-out");

function logLine(file: string, line: string): void {
  writeFileSync(file, `${line}\n`, { flag: "a" });
  process.stdout.write(`${line}\n`);
}

async function runOnce(label: string, logPath: string, jsonPath: string) {
  const logs: Record<string, unknown>[] = [];
  const config = parseAsaasConfig({
    ASAAS_ENVIRONMENT: "sandbox",
    ASAAS_API_KEY: "fixture-local-key-do-not-send",
  });
  const recording = new RecordingTransport(createFixtureTransport());
  const snapshot = await collectFinanceSnapshot({
    config,
    transport: recording,
    webhookEvents: loadWebhookEvents(),
    now: NOW,
    logSink: (row) => logs.push(row),
  });

  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  writeFileSync(logPath, `${logs.map((row) => JSON.stringify(row)).join("\n")}\n`);

  const liveEnvKey = process.env.ASAAS_API_KEY;
  if (liveEnvKey && JSON.stringify(logs).includes(liveEnvKey)) {
    throw new Error("consumer used the process env API key");
  }
  if (recording.log.some((e) => e.method !== "GET" || e.body !== null)) {
    throw new Error("consumer issued a non-GET or GET-with-body");
  }

  const { contracted, billed, paid, received } = snapshot.buckets;
  if (new Set([contracted.cents, billed.cents, paid.cents, received.cents]).size < 3) {
    throw new Error("expected distinct contracted/billed/paid/received totals");
  }
  if (received.provider_ids.includes("pay_fixtureConfirmed01")) {
    throw new Error("CONFIRMED leaked into received");
  }
  if (paid.cents <= received.cents) {
    throw new Error("paid should exceed received when CONFIRMED is present");
  }
  const confirmed = snapshot.entities.charges.find(
    (c) => c.provider_id === "pay_fixtureConfirmed01",
  );
  if (!confirmed?.amount || confirmed.amount.currency !== "BRL") {
    throw new Error("CONFIRMED amount missing cents+currency");
  }
  if (!Number.isInteger(confirmed.amount.cents)) {
    throw new Error("amount is not integer cents");
  }
  for (const field of ["source", "observed_at", "freshness_status"] as const) {
    if (!snapshot[field]) {
      throw new Error(`snapshot missing ${field}`);
    }
    if (!confirmed.provenance[field]) {
      throw new Error(`charge provenance missing ${field}`);
    }
  }
  if (snapshot.entities.pix.length < 1) {
    throw new Error("expected PIX entity");
  }
  if (snapshot.entities.subscriptions.length < 1) {
    throw new Error("expected subscription entity");
  }
  if (!confirmed.external_reference) {
    throw new Error("expected externalReference");
  }

  logLine(
    logPath,
    `${label} charges=${snapshot.entities.charges.length} contracted=${contracted.cents} billed=${billed.cents} paid=${paid.cents} received=${received.cents} freshness=${snapshot.freshness_status}`,
  );
  return snapshot;
}

const consumer1Log = join(OUT_DIR, "consumer-1.log");
const consumer2Log = join(OUT_DIR, "consumer-2.log");
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(consumer1Log, "");
writeFileSync(consumer2Log, "");

const snap1 = await runOnce(
  "consumer-1",
  consumer1Log,
  join(OUT_DIR, "consumer-1.json"),
);
const snap2 = await runOnce(
  "consumer-2",
  consumer2Log,
  join(OUT_DIR, "consumer-2.json"),
);

if (JSON.stringify(snapshotStableView(snap1)) !== JSON.stringify(snapshotStableView(snap2))) {
  throw new Error("second collect did not match first (idempotency)");
}

logLine(consumer2Log, "consumer_ok");
process.stdout.write(`consumer_ok dir=${OUT_DIR}\n`);
