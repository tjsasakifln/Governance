import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSafeLogFields, createLogger } from "../src/log.ts";

test("structured logger writes JSON UTC records and refuses secret field names", () => {
  const lines: string[] = [];
  const logger = createLogger("control-center-deploy", (line) => {
    lines.push(line);
  });
  logger.info("backup.ok", {
    source: "postgres.control_center",
    observed_at: "2026-08-20T06:00:00Z",
    freshness_status: "fresh",
    bytes_plaintext: 12,
  });
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0] ?? "{}") as {
    ts: string;
    level: string;
    msg: string;
    service: string;
  };
  assert.equal(rec.level, "info");
  assert.equal(rec.msg, "backup.ok");
  assert.equal(rec.service, "control-center-deploy");
  assert.match(rec.ts, /Z$/);
  assert.throws(() => assertSafeLogFields({ password: "x" }), /secret-bearing/);
  assert.throws(() => logger.error("nope", { CONTROL_CENTER_BACKUP_KEY: "x" }), /secret-bearing/);
});
