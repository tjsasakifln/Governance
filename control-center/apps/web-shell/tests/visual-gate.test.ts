import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { installShellGlobals, type ShellWindow } from "../src/boot";
import {
  VISUAL_GATE_SCHEMA,
  VISUAL_GATE_STATES,
  VISUAL_GATE_VIEWPORTS,
  registeredVisualRoutes,
  visualMatrixConsistencyErrors,
} from "../src/visual-matrix";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const repoRoot = join(appRoot, "../../..");

test("visual route inventory is derived, unique and complete", () => {
  const routes = registeredVisualRoutes();
  assert.equal(routes.length, 19);
  assert.equal(routes.filter((route) => route.kind === "destination").length, 10);
  assert.equal(routes.filter((route) => route.kind === "surface").length, 9);
  assert.deepEqual(visualMatrixConsistencyErrors(), []);
  assert.equal(new Set(routes.map((route) => route.hash)).size, routes.length);
  assert.ok(routes.some((route) => route.hash === "#/comercial/excecoes"));
  assert.ok(routes.some((route) => route.hash === "#/warmbly/revisao"));
});

test("browser exposes the same route inventory consumed by the real gate", () => {
  const win: ShellWindow = { location: { protocol: "http:" } };
  const globals = installShellGlobals(win);
  assert.deepEqual(globals.visualRoutes, registeredVisualRoutes());
  assert.equal(globals.visualRoutes.length, 19);
});

test("gate contract pins three evidence viewports and five distinct states", () => {
  assert.equal(VISUAL_GATE_SCHEMA, "control-center.visual-gate.v1");
  assert.deepEqual(VISUAL_GATE_VIEWPORTS, [
    { id: "390", width: 390, height: 844 },
    { id: "tablet-768", width: 768, height: 1024 },
    { id: "desktop-1440", width: 1440, height: 1000 },
  ]);
  assert.deepEqual(VISUAL_GATE_STATES, ["ready", "loading", "empty", "stale", "error"]);
});

test("launch probe consumes browser routes, runs axe and emits a sanitized manifest", () => {
  const probe = readFileSync(join(appRoot, "scripts/launch-probe.mjs"), "utf8");
  assert.match(probe, /__CONFENGE_CONTROL_CENTER__\?\.visualRoutes/);
  assert.match(probe, /require\.resolve\("axe-core\/axe\.min\.js"\)/);
  assert.match(probe, /wcag2aa/);
  assert.match(probe, /serious.*critical|critical.*serious/s);
  assert.match(probe, /visual-gate-manifest\.json/);
  assert.match(probe, /ISOLATED_AUTHENTICATED_E2E/);
  assert.match(probe, /live_production_claimed:\s*false/);
  assert.match(probe, /real_email_sent:\s*false/);
  assert.match(probe, /outbound_resumed:\s*false/);
  assert.doesNotMatch(probe, /const destinations\s*=\s*\[/);
  assert.doesNotMatch(probe, /const extraHashes\s*=\s*\[/);
});

test("e2e reducer rejects concrete axe, overflow, scroll and safety failures", () => {
  const runner = readFileSync(join(appRoot, "scripts/e2e.mjs"), "utf8");
  assert.match(runner, /assertVisualGateManifest/);
  assert.match(runner, /serious_or_critical !== 0/);
  assert.match(runner, /horizontal_overflow_px > 1/);
  assert.match(runner, /document_scroll_range_px > 1/);
  assert.match(runner, /competing_scroll_owners\.length > 0/);
  assert.match(runner, /forbidden side effect/);
  assert.match(runner, /visual_gate=PASS/);
});

test("CI uploads screenshots and the machine manifest even on failure", () => {
  const workflow = readFileSync(join(repoRoot, ".github/workflows/control-center.yml"), "utf8");
  assert.match(workflow, /control-center-visual-gate/);
  assert.match(workflow, /visual_routes=/);
  assert.match(workflow, /visual_gate=PASS/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
});
