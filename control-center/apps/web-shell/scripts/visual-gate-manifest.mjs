const EXPECTED_VIEWPORTS = [
  { id: "390", width: 390, height: 844 },
  { id: "tablet-768", width: 768, height: 1024 },
  { id: "desktop-1440", width: 1440, height: 1000 },
];
const EXPECTED_STATES = ["ready", "loading", "empty", "stale", "error"];
const EXPECTED_CATALOG_VIEWPORTS = [
  { id: "390", width: 390, height: 844 },
  { id: "desktop-1440", width: 1440, height: 1000 },
];

function fail(message) {
  throw new Error(`invalid visual gate manifest: ${message}`);
}

function checkKey(check) {
  return `${check.route}\u0000${check.viewport}\u0000${check.state}`;
}

function requiredCells(routes) {
  const cells = [];
  const today = routes.find((route) => route.key === "destination:hoje");
  if (!today) fail("route inventory omitted destination:hoje");
  for (const viewport of EXPECTED_VIEWPORTS) {
    for (const route of routes) {
      cells.push({ route: route.key, viewport: viewport.id, state: "ready" });
    }
    const stateRoutes = viewport.id === "390" ? routes : [today];
    for (const route of stateRoutes) {
      for (const state of EXPECTED_STATES.slice(1)) {
        cells.push({ route: route.key, viewport: viewport.id, state });
      }
    }
  }
  return cells;
}

function assertRoutes(routes) {
  if (!Array.isArray(routes) || routes.length < 10) fail("route inventory is incomplete");
  const keys = new Set();
  const hashes = new Set();
  for (const route of routes) {
    if (!route || typeof route !== "object"
      || typeof route.key !== "string" || route.key.length === 0
      || typeof route.hash !== "string" || !route.hash.startsWith("#/")
      || typeof route.label !== "string" || route.label.length === 0
      || (route.kind !== "destination" && route.kind !== "surface")) {
      fail("route inventory contains an invalid route");
    }
    if (keys.has(route.key) || hashes.has(route.hash)) fail("route inventory contains duplicates");
    keys.add(route.key);
    hashes.add(route.hash);
  }
  if ([...keys].filter((key) => key.startsWith("destination:")).length < 10) {
    fail("route inventory omitted a global destination");
  }
  return keys;
}

function assertSafety(safety) {
  if (!safety || typeof safety !== "object"
    || !Number.isInteger(safety.observed_request_count)
    || safety.observed_request_count < 1
    || !Array.isArray(safety.observed_write_requests)
    || !Array.isArray(safety.allowed_local_control_center_writes)
    || safety.allowed_local_control_center_writes.length !== 1
    || !Array.isArray(safety.unsafe_write_requests)
    || safety.unsafe_write_requests.length !== 0
    || safety.real_email_sent !== false
    || safety.go_issued !== false
    || safety.outbound_resumed !== false
    || safety.irreversible_action !== false) {
    fail("network-derived safety proof is absent or unsafe");
  }
  const allowed = safety.allowed_local_control_center_writes[0];
  if (allowed?.method !== "POST"
    || allowed?.path !== "/v1/operator-actions"
    || allowed?.action_type !== "START_EXCEPTION_WORK") {
    fail("the only allowed local write is not the fixture audit action");
  }
  if (safety.observed_write_requests.length !== 1
    || JSON.stringify(safety.observed_write_requests[0]) !== JSON.stringify(allowed)) {
    fail("observed writes do not match the single allowed local audit write");
  }
}

function assertCatalog(catalog) {
  if (!catalog || typeof catalog !== "object"
    || catalog.id !== "operational-component-catalog"
    || catalog.components !== 10
    || catalog.state !== "extreme-fixtures"
    || JSON.stringify(catalog.viewports) !== JSON.stringify(EXPECTED_CATALOG_VIEWPORTS)
    || !Array.isArray(catalog.checks)) {
    fail("operational component catalog contract is absent or malformed");
  }
  const required = new Set(EXPECTED_CATALOG_VIEWPORTS.map((viewport) => viewport.id));
  const axeByViewport = new Map();
  const geometryByViewport = new Map();
  for (const check of catalog.checks) {
    if (!check || typeof check !== "object"
      || check.route !== catalog.id
      || check.state !== catalog.state
      || !required.has(check.viewport)) {
      fail("component catalog check contains an unknown route, viewport or state");
    }
    if (check.kind === "axe") {
      if (axeByViewport.has(check.viewport)
        || check.serious_or_critical !== 0
        || !Array.isArray(check.violations)
        || check.violations.some((item) => item?.impact === "serious" || item?.impact === "critical")) {
        fail("component catalog axe result is duplicated or contains a blocker");
      }
      axeByViewport.set(check.viewport, check);
    } else if (check.kind === "geometry") {
      if (geometryByViewport.has(check.viewport)
        || !Number.isFinite(check.horizontal_overflow_px)
        || !Number.isFinite(check.main_horizontal_overflow_px)
        || !Number.isFinite(check.document_scroll_range_px)
        || check.horizontal_overflow_px > 1
        || check.main_horizontal_overflow_px > 1
        || check.document_scroll_range_px > 1
        || !Array.isArray(check.competing_scroll_owners)
        || check.competing_scroll_owners.length > 0) {
        fail("component catalog geometry result is duplicated, malformed or failing");
      }
      geometryByViewport.set(check.viewport, check);
    } else {
      fail("component catalog contains an unknown check kind");
    }
  }
  for (const viewport of required) {
    if (!axeByViewport.has(viewport) || !geometryByViewport.has(viewport)) {
      fail(`component catalog evidence is absent for ${viewport}`);
    }
  }
  if (axeByViewport.size !== required.size || geometryByViewport.size !== required.size) {
    fail("component catalog matrix contains unexpected extra cells");
  }
  return { axe: axeByViewport.size, geometry: geometryByViewport.size };
}

export function assertVisualGateManifest(manifest, expectedRuntimeSha) {
  if (!manifest || typeof manifest !== "object"
    || manifest.schema_version !== "control-center.visual-gate.v1"
    || manifest.execution !== "ISOLATED_AUTHENTICATED_E2E"
    || manifest.live_production_claimed !== false
    || manifest.result !== "PASS"
    || manifest.runtime_sha !== expectedRuntimeSha
    || !Array.isArray(manifest.checks)) {
    fail("envelope or runtime identity is invalid");
  }
  if (JSON.stringify(manifest.viewports) !== JSON.stringify(EXPECTED_VIEWPORTS)) {
    fail("evidence viewport matrix drifted");
  }
  if (JSON.stringify(manifest.states) !== JSON.stringify(EXPECTED_STATES)) {
    fail("view-state matrix drifted");
  }

  const routeKeys = assertRoutes(manifest.routes);
  const cells = requiredCells(manifest.routes);
  const required = new Set(cells.map(checkKey));
  const axeByCell = new Map();
  const geometryByCell = new Map();

  for (const check of manifest.checks) {
    if (!check || typeof check !== "object"
      || !routeKeys.has(check.route)
      || typeof check.viewport !== "string"
      || !EXPECTED_STATES.includes(check.state)) {
      fail("check contains an unknown route, viewport or state");
    }
    const key = checkKey(check);
    if (check.kind === "axe") {
      if (!required.has(key) || axeByCell.has(key)
        || check.serious_or_critical !== 0
        || !Array.isArray(check.violations)
        || check.violations.some((item) => item?.impact === "serious" || item?.impact === "critical")) {
        fail("axe result is duplicated, out of matrix or contains a blocker");
      }
      axeByCell.set(key, check);
    } else if (check.kind === "geometry") {
      if (geometryByCell.has(key)
        || !Number.isFinite(check.horizontal_overflow_px)
        || !Number.isFinite(check.main_horizontal_overflow_px)
        || !Number.isFinite(check.document_scroll_range_px)
        || check.horizontal_overflow_px > 1
        || check.main_horizontal_overflow_px > 1
        || check.document_scroll_range_px > 1
        || !Array.isArray(check.competing_scroll_owners)
        || check.competing_scroll_owners.length > 0) {
        fail("geometry result is duplicated, malformed or failing");
      }
      geometryByCell.set(key, check);
    } else {
      fail("unknown check kind");
    }
  }

  for (const key of required) {
    if (!axeByCell.has(key) || !geometryByCell.has(key)) {
      fail(`required axe/geometry cell is absent: ${key.replaceAll("\u0000", "/")}`);
    }
  }
  if (axeByCell.size !== required.size) fail("axe matrix has unexpected extra cells");
  const catalog = assertCatalog(manifest.catalog);
  assertSafety(manifest.safety);
  return {
    routes: manifest.routes.length,
    axe: axeByCell.size,
    geometry: geometryByCell.size,
    catalogAxe: catalog.axe,
    catalogGeometry: catalog.geometry,
  };
}
