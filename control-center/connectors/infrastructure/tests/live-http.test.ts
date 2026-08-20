import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { parseAllowlist } from "../src/allowlist.js";
import { collect } from "../src/collect.js";
import { createLivePorts } from "../src/live-ports.js";

function listen(handler: http.RequestListener): Promise<http.Server> {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

function portOf(server: http.Server): number {
  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error("server has no address");
  }
  return address.port;
}

test("live HTTP probe turns 503 into an evidenced exception", async () => {
  const down = await listen((_req, res) => {
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("down");
  });
  const up = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  try {
    const allowlist = parseAllowlist({
      version: 1,
      collector_id: "infrastructure.netcup",
      source: "infrastructure",
      default_timeout_ms: 200,
      targets: [
        {
          id: "svc-down",
          display_name: "svc-down",
          url: `http://127.0.0.1:${portOf(down)}/health`,
          expect_status: 200,
          checks: ["http"],
        },
        {
          id: "svc-up",
          display_name: "svc-up",
          url: `http://127.0.0.1:${portOf(up)}/health`,
          expect_status: 200,
          checks: ["http"],
        },
      ],
    });
    const now = new Date("2026-08-20T15:00:00.000Z");
    const result = await collect({
      allowlist,
      ports: createLivePorts({ now: () => now }),
    });
    const failed = result.exceptions.find((item) => item.target_id === "svc-down");
    assert.ok(failed);
    assert.match(failed.evidence, /svc-down/);
    assert.match(failed.evidence, /503/);
    assert.equal(failed.timestamp, now.toISOString());
    const upHealth = result.service_health.find((item) => item.service_id === "svc-up");
    assert.equal(upHealth?.status, "healthy");
    assert.equal(upHealth?.freshness_status, "FRESH");
  } finally {
    down.closeAllConnections();
    up.closeAllConnections();
    down.close();
    up.close();
  }
});

test("live HTTP hang is a timeout exception, not healthy-FRESH", async () => {
  const hung = await listen(() => {
    /* never respond */
  });
  const up = await listen((_req, res) => {
    res.writeHead(200);
    res.end("ok");
  });
  try {
    const allowlist = parseAllowlist({
      version: 1,
      collector_id: "infrastructure.netcup",
      source: "infrastructure",
      default_timeout_ms: 40,
      targets: [
        {
          id: "svc-hang",
          display_name: "svc-hang",
          url: `http://127.0.0.1:${portOf(hung)}/health`,
          expect_status: 200,
          checks: ["http"],
        },
        {
          id: "svc-up",
          display_name: "svc-up",
          url: `http://127.0.0.1:${portOf(up)}/health`,
          expect_status: 200,
          checks: ["http"],
        },
      ],
    });
    const result = await collect({
      allowlist,
      ports: createLivePorts({ now: () => new Date("2026-08-20T15:00:00.000Z") }),
    });
    const hungObs = result.observations.find((item) => item.target_id === "svc-hang");
    assert.ok(hungObs);
    assert.equal(hungObs.freshness_status, "ERROR");
    assert.notEqual(`${hungObs.payload.service_status}-${hungObs.freshness_status}`, "healthy-FRESH");
    assert.ok(result.exceptions.some((item) => item.target_id === "svc-hang"));
    const upHealth = result.service_health.find((item) => item.service_id === "svc-up");
    assert.equal(upHealth?.status, "healthy");
    assert.equal(upHealth?.freshness_status, "FRESH");
  } finally {
    hung.closeAllConnections();
    up.closeAllConnections();
    hung.close();
    up.close();
  }
});
