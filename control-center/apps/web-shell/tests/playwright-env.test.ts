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
  assert.match(source, /CONTEXT_SERVICE_FIXTURE/);
  assert.match(source, /CC_CONTEXT_UPSTREAM/);
});
