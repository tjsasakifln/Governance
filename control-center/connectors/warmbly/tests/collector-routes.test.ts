import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { COLLECT_ROUTES } from "../src/collector/routes.ts";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "../src");

/**
 * `assignRoute` is a hand-written switch. A route added to COLLECT_ROUTES with
 * no matching case is still fetched — the request is made and paid for — and
 * then silently dropped, so the surface downstream renders "not observed" about
 * data that was, in fact, observed.
 *
 * That is exactly what happened to `confenge_dispatch_status`: the collector
 * logged `status: 200` for it while the cockpit reported UNKNOWN.
 */
test("every collected route is assigned into the payload, not silently dropped", () => {
  const fetchSrc = readFileSync(join(srcDir, "collector/fetch.ts"), "utf8");
  const missing = COLLECT_ROUTES.map((route) => route.key).filter(
    (key) => !fetchSrc.includes(`case "${key}":`),
  );
  assert.deepEqual(
    missing,
    [],
    `these routes are fetched but never assigned in assignRoute: ${missing.join(", ")}`,
  );
});
