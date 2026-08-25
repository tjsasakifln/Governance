import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { installShellGlobals, type ShellWindow } from "../src/boot";
import { assertVisualGateManifest } from "../scripts/visual-gate-manifest.mjs";
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

function completeManifest(): Record<string, unknown> {
  const routes = Array.from({ length: 10 }, (_, index) => ({
    key: index === 0 ? "destination:hoje" : `destination:area-${index}`,
    hash: index === 0 ? "#/hoje" : `#/area-${index}`,
    label: index === 0 ? "Hoje" : `Área ${index}`,
    kind: "destination",
  }));
  const viewports = [
    { id: "390", width: 390, height: 844 },
    { id: "tablet-768", width: 768, height: 1024 },
    { id: "desktop-1440", width: 1440, height: 1000 },
  ];
  const states = ["ready", "loading", "empty", "stale", "error"];
  const cells: Array<{ route: string; viewport: string; state: string }> = [];
  for (const viewport of viewports) {
    for (const route of routes) {
      cells.push({ route: route.key, viewport: viewport.id, state: "ready" });
    }
    const stateRoutes = viewport.id === "390" ? routes : [routes[0]];
    for (const route of stateRoutes) {
      assert.ok(route);
      for (const state of states.slice(1)) {
        cells.push({ route: route.key, viewport: viewport.id, state });
      }
    }
  }
  const checks = cells.flatMap((cell) => [
    {
      kind: "axe",
      ...cell,
      where: `${cell.viewport}/${cell.route}/${cell.state}`,
      violations: [],
      serious_or_critical: 0,
    },
    {
      kind: "geometry",
      ...cell,
      horizontal_overflow_px: 0,
      main_horizontal_overflow_px: 0,
      document_scroll_range_px: 0,
      competing_scroll_owners: [],
    },
  ]);
  const allowedWrite = {
    method: "POST",
    path: "/v1/operator-actions",
    action_type: "START_EXCEPTION_WORK",
  };
  const catalogChecks = ["390", "desktop-1440"].flatMap((viewport) => [
    {
      kind: "axe",
      route: "operational-component-catalog",
      viewport,
      state: "extreme-fixtures",
      violations: [],
      serious_or_critical: 0,
    },
    {
      kind: "geometry",
      route: "operational-component-catalog",
      viewport,
      state: "extreme-fixtures",
      horizontal_overflow_px: 0,
      main_horizontal_overflow_px: 0,
      document_scroll_range_px: 0,
      competing_scroll_owners: [],
    },
  ]);
  return {
    schema_version: "control-center.visual-gate.v1",
    execution: "ISOLATED_AUTHENTICATED_E2E",
    live_production_claimed: false,
    result: "PASS",
    runtime_sha: "8a2eb1f012345678901234567890123456789012",
    routes,
    viewports,
    states,
    checks,
    catalog: {
      id: "operational-component-catalog",
      components: 10,
      state: "extreme-fixtures",
      viewports: [
        { id: "390", width: 390, height: 844 },
        { id: "desktop-1440", width: 1440, height: 1000 },
      ],
      checks: catalogChecks,
    },
    safety: {
      observed_request_count: 50,
      observed_write_requests: [allowedWrite],
      allowed_local_control_center_writes: [allowedWrite],
      unsafe_write_requests: [],
      real_email_sent: false,
      go_issued: false,
      outbound_resumed: false,
      irreversible_action: false,
    },
  };
}

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
  assert.match(probe, /page\.on\("request"/);
  assert.match(probe, /networkSafetySnapshot/);
  assert.match(probe, /START_EXCEPTION_WORK/);
  assert.doesNotMatch(probe, /const destinations\s*=\s*\[/);
  assert.doesNotMatch(probe, /const extraHashes\s*=\s*\[/);
});

test("manifest reducer accepts the complete route/state/viewport cross-product", () => {
  const result = assertVisualGateManifest(
    completeManifest(),
    "8a2eb1f012345678901234567890123456789012",
  );
  assert.deepEqual(result, {
    routes: 10,
    axe: 78,
    geometry: 78,
    catalogAxe: 2,
    catalogGeometry: 2,
  });
});

test("manifest reducer requires the operational catalog in mobile and desktop", () => {
  const missing = completeManifest();
  delete missing.catalog;
  assert.throws(
    () => assertVisualGateManifest(missing, String(missing.runtime_sha)),
    /component catalog contract is absent/,
  );

  const failing = completeManifest();
  const catalog = failing.catalog as { checks: Array<Record<string, unknown>> };
  const geometry = catalog.checks.find((check) => check.kind === "geometry");
  assert.ok(geometry);
  geometry.horizontal_overflow_px = 2;
  assert.throws(
    () => assertVisualGateManifest(failing, String(failing.runtime_sha)),
    /component catalog geometry result.*failing/,
  );
});

test("manifest reducer rejects omitted coverage, lying axe counts and runtime drift", () => {
  const missing = completeManifest();
  const missingChecks = missing.checks as unknown[];
  missingChecks.splice(0, 1);
  assert.throws(
    () => assertVisualGateManifest(missing, String(missing.runtime_sha)),
    /required axe\/geometry cell is absent/,
  );

  const lying = completeManifest();
  const axe = (lying.checks as Array<Record<string, unknown>>).find(
    (check) => check.kind === "axe",
  );
  assert.ok(axe);
  axe.violations = [{ impact: "critical" }];
  assert.throws(
    () => assertVisualGateManifest(lying, String(lying.runtime_sha)),
    /contains a blocker/,
  );

  const drift = completeManifest();
  assert.throws(
    () => assertVisualGateManifest(drift, "9".repeat(40)),
    /runtime identity is invalid/,
  );
});

test("manifest reducer requires observed network safety instead of declared booleans", () => {
  const unobserved = completeManifest();
  (unobserved.safety as Record<string, unknown>).observed_request_count = 0;
  assert.throws(
    () => assertVisualGateManifest(unobserved, String(unobserved.runtime_sha)),
    /network-derived safety proof is absent/,
  );

  const unsafe = completeManifest();
  const safety = unsafe.safety as Record<string, unknown>;
  safety.unsafe_write_requests = [
    { method: "POST", path: "/v1/warmbly/dispatch/resume", action_type: "RESUME" },
  ];
  safety.outbound_resumed = true;
  assert.throws(
    () => assertVisualGateManifest(unsafe, String(unsafe.runtime_sha)),
    /network-derived safety proof is absent/,
  );
});

test("CI uploads screenshots and the machine manifest even on failure", () => {
  const workflow = readFileSync(join(repoRoot, ".github/workflows/control-center.yml"), "utf8");
  assert.match(workflow, /control-center-visual-gate/);
  assert.match(workflow, /visual_routes=/);
  assert.match(workflow, /visual_gate=PASS/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
});
