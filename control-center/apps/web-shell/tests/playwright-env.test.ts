import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isOsLibLauncherFailure } from "../src/playwright-env";

const here = dirname(fileURLToPath(import.meta.url));

test("OS-lib launcher failures are classified separately from app assertions", () => {
  assert.equal(
    isOsLibLauncherFailure("error while loading shared libraries: libnspr4.so: cannot open shared object file"),
    true,
  );
  assert.equal(isOsLibLauncherFailure("playwright chromium not resolvable"), true);
  assert.equal(isOsLibLauncherFailure("Hoje has no attention items"), false);
  assert.equal(isOsLibLauncherFailure("nav did not change destination: hoje"), false);
});

test("web-shell e2e fails closed when Playwright launched and the app assertion failed", () => {
  const source = readFileSync(join(here, "../scripts/e2e.mjs"), "utf8");
  assert.match(source, /isOsLibLauncherFailure/);
  assert.match(source, /production web-shell assertion failed/);
  assert.match(source, /boot-production-context/);
  assert.doesNotMatch(source, /CONTEXT_SERVICE_FIXTURE/);
  assert.match(source, /CC_CONTEXT_UPSTREAM/);
});

test("production e2e boot does not use CONTEXT_SERVICE_FIXTURE", () => {
  const boot = readFileSync(join(here, "../../../scripts/boot-production-context.ts"), "utf8");
  assert.match(boot, /startIsolatedTestPostgres/);
  assert.match(boot, /createPostgresStoreFromPool/);
  assert.doesNotMatch(boot, /CONTEXT_SERVICE_FIXTURE/);
  const probe = readFileSync(join(here, "../scripts/launch-probe.mjs"), "utf8");
  assert.match(probe, /360/);
  assert.match(probe, /390/);
  assert.match(probe, /430/);
  assert.match(probe, /desktop/);
  assert.match(probe, /view_state_driven/);
});

test("production e2e proves fail-closed truth gating before the authorized receipt flow", () => {
  const boot = readFileSync(join(here, "../../../scripts/boot-production-context.ts"), "utf8");
  assert.match(boot, /operatorActor:\s*\(\)\s*=>\s*FOUNDER/);

  const probe = readFileSync(join(here, "../scripts/launch-probe.mjs"), "utf8");
  const negativeBoundary = probe.indexOf("exception_without_truth");
  const healthyBoundary = probe.indexOf("complete grouped exception payload should be HEALTHY");
  const receiptBoundary = probe.indexOf('data-action-receipt="true"');
  assert.ok(negativeBoundary >= 0, "probe must exercise an exception response without truth");
  assert.ok(healthyBoundary > negativeBoundary, "probe must restore and require HEALTHY truth before writing");
  assert.ok(receiptBoundary > healthyBoundary, "probe must only require a receipt after HEALTHY gating");
  assert.match(probe, /truth-less exception fixture exposed START_EXCEPTION_WORK/);
  assert.match(probe, /data-list-writes-allowed/);
});
