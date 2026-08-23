import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateOperationalEnvelope } from "../../../contracts/src/operational-envelope.ts";
import { frozenClock } from "../src/clock.ts";
import { createRequestListener } from "../src/http.ts";
import { silentLogger } from "../src/log.ts";
import { createFixtureOperationalPort } from "../src/operational/fixture.ts";
import { representativeOperationalData } from "../src/operational/representative.ts";
import { createOperationalService } from "../src/operational/service.ts";
import { REPRESENTATIVE_REPO_DOMAINS } from "../src/representative.ts";
import { FOUNDER, NOW, makeService } from "./helpers.ts";

/**
 * Keeps the cockpit's recorded payload honest.
 *
 * `apps/web-shell/tests/fixtures/operational-today.golden.json` is what the
 * web shell renders in its alert tests. It is not hand-written: it is the byte
 * output of this service over `representativeOperationalData()`. If the
 * attention engine, the signal set or the HTTP shape changes, this test fails
 * first and the recorded payload has to be re-captured — the shell can never
 * be tested against a shape production stopped emitting.
 */
const GOLDEN_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../apps/web-shell/tests/fixtures/operational-today.golden.json",
);

const CAPTURED_PATHS = {
  today: "/v1/today?scope=company",
  attention_now: "/v1/attention?scope=company&horizon=now",
  attention_today: "/v1/attention?scope=company&horizon=today",
} as const;

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const { service } = makeService();
  const server = createServer(
    createRequestListener({
      service,
      operational: createOperationalService({
        port: createFixtureOperationalPort(structuredClone(representativeOperationalData())),
        clock: frozenClock(NOW),
        founderActorId: FOUNDER.id,
        repoDomains: REPRESENTATIVE_REPO_DOMAINS,
      }),
      logger: silentLogger,
    }),
  );
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  try {
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test("the recorded cockpit payload is byte-for-byte what this service serves today", async () => {
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(golden).sort(), Object.keys(CAPTURED_PATHS).sort());
  await withServer(async (base) => {
    for (const [key, path] of Object.entries(CAPTURED_PATHS)) {
      const res = await fetch(`${base}${path}`, {
        headers: { "x-actor-id": FOUNDER.id, "x-actor-kind": FOUNDER.kind },
      });
      assert.equal(res.status, 200, path);
      const live = (await res.json()) as unknown;
      assert.deepEqual(
        live,
        golden[key],
        `${path} drifted from apps/web-shell/tests/fixtures/operational-today.golden.json; re-capture it`,
      );
    }
  });
});

test("the recorded ranked items are engine output: formula prose plus a full breakdown", () => {
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as {
    today: { today: Array<Record<string, unknown>> };
    attention_now: { items: Array<Record<string, unknown>> };
  };
  const items = [...golden.today.today, ...golden.attention_now.items];
  assert.ok(items.length >= 3);
  for (const item of items) {
    assert.equal(typeof item.reason, "string");
    assert.match(item.reason as string, /peso_categoria/);
    assert.ok(item.score_breakdown, "ranked item must carry score_breakdown");
    assert.ok(typeof item.category === "string");
    assert.ok(typeof item.domain === "string");
  }
  // Criterion 5 needs both bands present in the recording, or the shell test
  // would be asserting a distinction the payload never exercises.
  const severities = new Set(items.map((item) => item.severity));
  assert.ok(severities.has("critical"), "recording lost its critical incident");
  assert.ok(severities.has("low"), "recording lost its low-severity cosmetic item");
  assert.ok(
    items.some((item) => item.forced_by_kill_rule === true),
    "recording lost its KILL-RULE item",
  );
});

test("both recorded envelopes still validate against operational-envelope.v1", () => {
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as {
    today: Record<string, unknown>;
    attention_now: Record<string, unknown>;
  };
  // `/v1/today` and `/v1/attention` are envelope projections: they carry the
  // envelope's own schema_version, so the shipped validator is the right gate
  // for the attention entries they embed.
  for (const key of ["today", "attention_now"] as const) {
    const projection = golden[key];
    const asEnvelope = {
      schema_version: projection.schema_version,
      scope: projection.scope,
      generated_at: projection.generated_at,
      freshness_status: projection.freshness_status,
      confidence: projection.confidence,
      snapshots: {
        commercial: null,
        finance: null,
        clients: null,
        engineering: null,
        infrastructure: null,
        pncp: null,
      },
      attention_now: key === "attention_now" ? projection.items : [],
      today: key === "today" ? projection.today : [],
      source_observations: [],
    };
    const result = validateOperationalEnvelope(asEnvelope);
    assert.equal(result.ok, true, `${key}: ${JSON.stringify(result.errors)}`);
  }
});
