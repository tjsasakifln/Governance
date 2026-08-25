/**
 * Headless launch of the previewed shell. Asserts the primary observable:
 * every nav label, Hoje attention + ≤3 priorities, nav changes destination.
 *
 * Usage: node scripts/launch-probe.mjs <baseUrl> <screenshotPath>
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function chromiumFrom(mod) {
  const chromium = mod?.chromium ?? mod?.default?.chromium;
  return chromium && typeof chromium.launch === "function" ? chromium : null;
}

async function loadPlaywright() {
  try {
    const local = chromiumFrom(await import("playwright"));
    if (local) return local;
  } catch {
    // fall through to npx cache
  }
  const npxRoot = join(homedir(), ".npm/_npx");
  if (existsSync(npxRoot)) {
    for (const entry of readdirSync(npxRoot)) {
      const candidate = join(npxRoot, entry, "node_modules/playwright");
      if (!existsSync(join(candidate, "package.json"))) continue;
      const resolved = chromiumFrom(await import(require.resolve(candidate)));
      if (resolved) return resolved;
    }
  }
  throw new Error("playwright chromium not resolvable");
}

const chromium = await loadPlaywright();

const baseUrl = process.argv[2];
const screenshotPath = process.argv[3];
if (!baseUrl || !screenshotPath) {
  console.error("usage: node scripts/launch-probe.mjs <baseUrl> <screenshotPath>");
  process.exit(2);
}

// Resource routes are journey evidence, not registry entries. The route matrix
// itself is read from the shipped browser global after boot.
const journeyHashes = ["clientes/acme"];
const minimalEvidence = process.env.CC_EVIDENCE_MINIMAL === "1";

/**
 * `matrixShots: false` keeps the per-hash overflow/layout assertions but stops
 * writing a full-page screenshot per hash, so the three desktop resolutions
 * required by the layout acceptance criteria do not triple the artifact size.
 */
const viewports = [
  { name: "360", width: 360, height: 800, matrixShots: true, visualGate: false },
  { name: "390", width: 390, height: 844, matrixShots: true, visualGate: true },
  { name: "430", width: 430, height: 932, matrixShots: true, visualGate: false },
  { name: "tablet-768", width: 768, height: 1024, matrixShots: true, visualGate: true },
  { name: "desktop", width: 1280, height: 800, matrixShots: true, visualGate: false },
  { name: "desktop-1366", width: 1366, height: 768, matrixShots: false, visualGate: false },
  { name: "desktop-1440", width: 1440, height: 1000, matrixShots: true, visualGate: true },
  { name: "desktop-1920", width: 1920, height: 1080, matrixShots: false, visualGate: false },
];

/** Matches the `--main-gutter` of the >=880px branch in src/styles.css. */
const DESKTOP_GUTTER_REM = 1.6;
/** Below this the shell is the single-column mobile layout: nav is a bottom bar. */
const DESKTOP_MIN_WIDTH = 880;
/**
 * Floor for "the main content actually uses the desktop width". The regression
 * this guards is `main { max-width: 52rem }` with no centering, which parked the
 * content on the left of a 1fr column and left ~47% of a 1920px viewport empty
 * (measured content ratio 0.41; the centred column measures 0.63).
 */
const MIN_CONTENT_RATIO = 0.55;

const viewStates = ["loading", "empty", "stale", "error"];
const visualManifestPath = join(dirname(screenshotPath), "visual-gate-manifest.json");
const visualManifest = {
  schema_version: "control-center.visual-gate.v1",
  execution: "ISOLATED_AUTHENTICATED_E2E",
  live_production_claimed: false,
  runtime_sha: null,
  routes: [],
  viewports: viewports
    .filter((viewport) => viewport.visualGate)
    .map(({ name, width, height }) => ({ id: name, width, height })),
  states: ["ready", ...viewStates],
  checks: [],
  catalog: {
    id: "operational-component-catalog",
    components: [],
    state: "extreme-fixtures",
    viewports: [
      { id: "390", width: 390, height: 844 },
      { id: "desktop-1440", width: 1440, height: 1000 },
    ],
    checks: [],
  },
  safety: {
    observed_request_count: 0,
    observed_write_requests: [],
    allowed_local_control_center_writes: [],
    unsafe_write_requests: [],
    real_email_sent: false,
    go_issued: false,
    outbound_resumed: false,
    irreversible_action: false,
  },
  result: "FAIL",
};
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const cachedChrome = join(
  homedir(),
  ".cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
);
const launchOptions = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
if (existsSync(cachedChrome)) {
  launchOptions.executablePath = cachedChrome;
}
let browser;
try {
  browser = await chromium.launch(launchOptions);
} catch (err) {
  console.error(String(err));
  process.exit(1);
}
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript({ content: axeSource });
const errors = [];
const observedRequests = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("crash", () => errors.push("page crashed"));
page.on("request", (request) => {
  const method = request.method().toUpperCase();
  let path = "invalid-url";
  try {
    path = new URL(request.url()).pathname;
  } catch {
    // Retain a bounded marker; never serialize the full malformed URL.
  }
  let actionType = null;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    try {
      const body = JSON.parse(request.postData() ?? "{}");
      actionType = typeof body.action_type === "string" ? body.action_type : null;
    } catch {
      // An unreadable write body is unsafe and will fail the allowlist below.
    }
  }
  observedRequests.push({ method, path, ...(actionType ? { action_type: actionType } : {}) });
});

function networkSafetySnapshot() {
  const writes = observedRequests.filter(
    (request) => !["GET", "HEAD", "OPTIONS"].includes(request.method),
  );
  const allowed = writes.filter(
    (request) => request.method === "POST"
      && request.path === "/v1/operator-actions"
      && request.action_type === "START_EXCEPTION_WORK",
  );
  const unsafe = writes.filter((request) => !allowed.includes(request));
  return {
    observed_request_count: observedRequests.length,
    observed_write_requests: writes,
    allowed_local_control_center_writes: allowed,
    unsafe_write_requests: unsafe,
    real_email_sent: writes.some((request) => /(?:email|send|dispatch)/i.test(`${request.path}/${request.action_type ?? ""}`)),
    go_issued: writes.some((request) => /(?:^|[/_-])go(?:$|[/_-])/i.test(`${request.path}/${request.action_type ?? ""}`)),
    outbound_resumed: writes.some((request) => /resume/i.test(`${request.path}/${request.action_type ?? ""}`)),
    irreversible_action: unsafe.length > 0,
  };
}

async function assertAxe(page, route, viewport, state, checks = visualManifest.checks) {
  const where = `${viewport}/${route}/${state}`;
  await page.waitForFunction(() => typeof globalThis.axe?.run === "function");
  const result = await page.evaluate(async () => {
    const report = await globalThis.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    return report.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
      node_count: violation.nodes.length,
    }));
  });
  const blockers = result.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  checks.push({
    kind: "axe",
    where,
    route,
    viewport,
    state,
    violations: result,
    serious_or_critical: blockers.length,
  });
  if (blockers.length > 0) {
    const detail = blockers
      .map((violation) => `${violation.id}[${violation.impact}](${violation.targets.join(",")})`)
      .join(" | ");
    throw new Error(`${where}: axe serious/critical violations: ${detail}`);
  }
  return result.length;
}

// The isolated Context harness has no Warmbly token, so its review proxy is
// deliberately unavailable. Intercept only the read endpoint with a realistic
// backlog to exercise the production-built list + inspector at volume without
// enabling any write or outbound side effect.
const reviewRows = Array.from({ length: 55 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  account_id: `account-e2e-${index}`,
  recipient: `contato-${index}@empresa-exemplo.test`,
  subject: `Revisão do primeiro toque ${index}`,
  body_text: `Olá,\n\nObservamos o edital público ${index} e gostaríamos de conversar com a pessoa responsável.\n\nPode nos encaminhar?`,
  state: "NEEDS_REVIEW",
  purpose: "INITIAL",
  ordinal: 1,
  content_hash: `sha256:e2e-${index}`,
  account: { nome_fantasia: `Empresa de infraestrutura ${index}` },
  fact_used: `Edital público ${index} observado no recorte atual`,
  evidence_ids: [`evidence-e2e-${index}`],
  fact_source: "e2e_fixture",
  route_class: "GENERIC_COMPANY",
  editorial_state: "CURRENT",
  editorial_actionable: true,
}));
await page.route(/\/v1\/commercial\/review-drafts(?:\?|$)/, async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      schema_version: "control-center.review-draft-page.v1",
      data: reviewRows,
      page: {
        limit: 100,
        offset: 0,
        loaded_count: 55,
        coverage_status: "TOTAL_KNOWN",
        total_count: 55,
        remaining_count: 0,
        has_more: false,
      },
    }),
  });
});

/**
 * Geometry of the content column plus every element that currently owns a
 * vertical scrollbar. `documentScrollRange` is probed by actually scrolling the
 * window: absolutely positioned descendants of a scroll container whose
 * containing block is the initial containing block escape that container and
 * inflate the document scrolling area without changing any element's box, so
 * box measurements alone do not see the second scrollbar.
 */
async function layoutMetrics(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const main = document.querySelector("main");
    if (!main) throw new Error("no <main> rendered");
    const cs = getComputedStyle(main);
    const rect = main.getBoundingClientRect();
    const padLeft = parseFloat(cs.paddingLeft);
    const padRight = parseFloat(cs.paddingRight);
    const remPx = parseFloat(getComputedStyle(de).fontSize);
    const contentMax = getComputedStyle(de).getPropertyValue("--content-max").trim();
    const contentLeft = rect.left + padLeft;
    const contentRight = rect.right - padRight;
    const owners = [];
    for (const el of document.querySelectorAll("html, body, *")) {
      const style = getComputedStyle(el);
      if (style.overflowY !== "auto" && style.overflowY !== "scroll") continue;
      if (el.scrollHeight - el.clientHeight <= 1) continue;
      const tag = el.tagName.toLowerCase();
      const label = tag + (el.id ? `#${el.id}` : "") + (el.className ? `.${String(el.className).trim().split(/\s+/).join(".")}` : "");
      owners.push({ label, insideMain: main.contains(el) && el !== main, isMain: el === main, isDocument: tag === "html" || tag === "body" });
    }
    const horizontalOffenders = [...main.querySelectorAll("*")]
      .map((el) => {
        const box = el.getBoundingClientRect();
        const ownOverflow = el.scrollWidth - el.clientWidth;
        const outsideLeft = Math.max(0, contentLeft - box.left);
        const outsideRight = Math.max(0, box.right - contentRight);
        const excess = Math.max(ownOverflow, outsideLeft, outsideRight);
        const tag = el.tagName.toLowerCase();
        const label = tag + (el.id ? `#${el.id}` : "") + (el.className ? `.${String(el.className).trim().split(/\s+/).join(".")}` : "");
        return { label, excess: Math.round(excess), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
      })
      .filter((item) => item.excess > 1)
      .sort((a, b) => b.excess - a.excess)
      .slice(0, 8);
    const restore = window.scrollY;
    window.scrollTo(0, 1_000_000);
    const documentScrollRange = window.scrollY;
    window.scrollTo(0, restore);
    return {
      viewportWidth: window.innerWidth,
      remPx,
      contentMaxPx: contentMax.endsWith("rem") ? parseFloat(contentMax) * remPx : parseFloat(contentMax),
      mainWidth: Math.round(rect.width),
      contentWidth: Math.round(rect.width - padLeft - padRight),
      padLeft: Math.round(padLeft),
      padRight: Math.round(padRight),
      deadRight: Math.round(window.innerWidth - (rect.right - padRight)),
      mainOverflowX: main.scrollWidth - main.clientWidth,
      horizontalOffenders,
      documentScrollRange,
      documentScrollHeightRange: de.scrollHeight - de.clientHeight,
      owners,
    };
  });
}

/**
 * Acceptance criteria of the desktop layout issue, asserted as geometry:
 * a single vertical scroll context, no dead right-hand panel, nothing clipped
 * horizontally inside the content column.
 */
function assertSingleScrollContext(m, where) {
  if (m.documentScrollRange > 1 || m.documentScrollHeightRange > 1) {
    throw new Error(
      `${where}: the page itself scrolls ${m.documentScrollRange}px (scrollHeight range ${m.documentScrollHeightRange}px) alongside the content scroller`,
    );
  }
  const stray = m.owners.filter((o) => o.isDocument || o.insideMain);
  if (stray.length > 0) {
    throw new Error(`${where}: competing vertical scroll owners ${stray.map((o) => o.label).join(", ")}`);
  }
  if (m.mainOverflowX > 1) {
    const offenders = m.horizontalOffenders
      .map((item) => `${item.label}:${item.excess}px(${item.scrollWidth}/${item.clientWidth})`)
      .join(", ");
    throw new Error(
      `${where}: content column clips ${m.mainOverflowX}px horizontally; offenders=${offenders || "unresolved"}`,
    );
  }
}

function assertContentColumn(m, where) {
  if (m.viewportWidth < DESKTOP_MIN_WIDTH) return;
  if (Math.abs(m.padLeft - m.padRight) > 1) {
    throw new Error(`${where}: content column is not centred (padding ${m.padLeft}/${m.padRight})`);
  }
  if (m.deadRight > m.padRight + 1) {
    throw new Error(
      `${where}: ${m.deadRight}px of empty panel to the right of the content, but the column gutter is only ${m.padRight}px -- the content column does not reach the right edge of the grid`,
    );
  }
  const cappedByDesign = m.contentWidth >= m.contentMaxPx - 1;
  const fullBleed = m.padLeft <= DESKTOP_GUTTER_REM * m.remPx + 1;
  if (!cappedByDesign && !fullBleed) {
    throw new Error(
      `${where}: content column neither reaches --content-max (${Math.round(m.contentMaxPx)}px) nor fills the grid column: width ${m.contentWidth}px, gutters ${m.padLeft}px`,
    );
  }
  const ratio = m.contentWidth / m.viewportWidth;
  if (ratio < MIN_CONTENT_RATIO) {
    throw new Error(
      `${where}: content uses only ${(ratio * 100).toFixed(1)}% of the viewport (${m.contentWidth}px of ${m.viewportWidth}px); dead space on the right is ${m.deadRight}px`,
    );
  }
}

async function assertFilled(page, minChars = 80) {
  const box = await page.locator("#root").boundingBox();
  if (!box || box.width < 300 || box.height < 240) {
    throw new Error(`render surface too small: ${JSON.stringify(box)}`);
  }
  const filled = await page.locator("#root").evaluate((el) => el.innerText.length);
  if (filled < minChars) {
    throw new Error(`render surface not substantially filled: ${filled} chars`);
  }
  return { box, filled };
}

/**
 * The CONFENGE mark has to be fetched and decoded by a real browser from the
 * real production server: a wrong Content-Type, a missing file in dist, or a
 * CSP that rejects the origin all leave naturalWidth at 0 while the markup
 * still looks right.
 */
async function assertBrand(page) {
  const brand = page.locator("header.topbar a.brand");
  if ((await brand.count()) !== 1) {
    throw new Error("topbar does not carry exactly one CONFENGE brand link");
  }
  const href = await brand.getAttribute("href");
  if (href !== "#/hoje") {
    throw new Error(`brand link href is ${href}, expected #/hoje`);
  }
  const logo = brand.locator("img.brand-logo");
  if (!(await logo.isVisible())) {
    throw new Error("CONFENGE mark is not visible in the topbar");
  }
  // Hash and viewport matrix navigation repaint the shell asynchronously. Wait
  // for the same image to be decoded and laid out, rather than sampling the
  // brief 0px box between the old and new paint. A genuinely missing/collapsed
  // mark still times out and fails this gate.
  await page.waitForFunction(() => {
    const image = document.querySelector("header.topbar img.brand-logo");
    if (!(image instanceof HTMLImageElement)) return false;
    return image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().height >= 14;
  }, undefined, { timeout: 5_000 });
  const alt = await logo.getAttribute("alt");
  if (alt !== "CONFENGE") {
    throw new Error(`brand logo alt is ${JSON.stringify(alt)}, expected "CONFENGE"`);
  }
  const info = await logo.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      src: el.currentSrc || el.src,
      complete: el.complete,
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
      width: box.width,
      height: box.height,
      filter: style.filter,
      opacity: Number.parseFloat(style.opacity),
    };
  });
  if (!info.complete || info.naturalWidth < 1 || info.naturalHeight < 1) {
    throw new Error(`CONFENGE mark did not decode from ${info.src}`);
  }
  if (info.height < 14) {
    throw new Error(`CONFENGE mark rendered too small to read: ${info.height}px tall`);
  }
  const natural = info.naturalWidth / info.naturalHeight;
  const rendered = info.width / info.height;
  if (Math.abs(rendered - natural) > 0.02 * natural) {
    throw new Error(
      `CONFENGE mark distorted: rendered ratio ${rendered.toFixed(3)} vs intrinsic ${natural.toFixed(3)}`,
    );
  }
  if (info.filter !== "none" || info.opacity < 1) {
    throw new Error(`CONFENGE mark recoloured: filter=${info.filter} opacity=${info.opacity}`);
  }
  const product = brand.locator(".brand-product");
  // textContent, not innerText: the label is uppercased by CSS only.
  const productText = (await product.textContent())?.trim();
  if (productText !== "Control Center") {
    throw new Error(`secondary product name is ${JSON.stringify(productText)}`);
  }
  const secondary = await product.evaluate((el) => {
    const logoEl = el.closest("a.brand")?.querySelector("img.brand-logo");
    const logoBox = logoEl.getBoundingClientRect();
    return {
      fontSize: Number.parseFloat(getComputedStyle(el).fontSize),
      logoHeight: logoBox.height,
    };
  });
  if (secondary.fontSize >= secondary.logoHeight) {
    throw new Error(
      `product name (${secondary.fontSize}px) is not subordinate to the CONFENGE mark (${secondary.logoHeight}px)`,
    );
  }
  return info;
}

try {
  const response = await page.goto(baseUrl, { waitUntil: "networkidle" });
  const status = response?.status() ?? 0;
  console.log(`status=${status}`);
  if (status !== 200) {
    throw new Error(`unexpected status ${status}`);
  }

  await page.waitForSelector('[data-destination="hoje"]');
  const viewState = await page.locator("[data-destination]").getAttribute("data-view-state");
  console.log(`view_state=${viewState}`);
  if (viewState === "error") {
    const banner = await page.locator("main").innerText();
    throw new Error(`production shell rendered error: ${banner.slice(0, 400)}`);
  }
  await page.waitForSelector(".attention");
  await page.waitForSelector(".priority");
  const filled = await assertFilled(page);
  console.log(`surface=${Math.round(filled.box.width)}x${Math.round(filled.box.height)}`);
  console.log(`filled_chars=${filled.filled}`);

  const routeInventory = await page.evaluate(() => {
    const routes = globalThis.__CONFENGE_CONTROL_CENTER__?.visualRoutes;
    return Array.isArray(routes) ? routes : null;
  });
  if (!routeInventory || routeInventory.length < 10) {
    throw new Error("browser did not expose the registry-derived visual route inventory");
  }
  if (new Set(routeInventory.map((route) => route.key)).size !== routeInventory.length
    || new Set(routeInventory.map((route) => route.hash)).size !== routeInventory.length) {
    throw new Error("registry-derived visual route inventory contains duplicates");
  }
  const destinationRoutes = routeInventory.filter((route) => route.kind === "destination");
  const destinations = destinationRoutes.map((route) => route.key.replace(/^destination:/, ""));
  const surfaceHashes = routeInventory
    .filter((route) => route.kind === "surface")
    .map((route) => route.hash.replace(/^#\//, ""));
  visualManifest.routes = routeInventory;
  console.log(`visual_routes=${routeInventory.length} source=browser_registry`);

  const interactionContract = await page.evaluate(() => {
    const contract = globalThis.__CONFENGE_CONTROL_CENTER__?.interactionContract;
    return contract && Array.isArray(contract.actionIds) && Array.isArray(contract.journeys)
      ? contract
      : null;
  });
  if (!interactionContract || interactionContract.actionIds.length !== 27
    || interactionContract.journeys.length !== 5
    || interactionContract.feedbackBudgetMs !== 100) {
    throw new Error("browser did not expose the complete mutable-interaction contract");
  }
  if (new Set(interactionContract.actionIds).size !== interactionContract.actionIds.length) {
    throw new Error("mutable-interaction contract lost an action identity");
  }
  if (interactionContract.journeys.some((journey) => journey.after >= journey.before)) {
    throw new Error("a critical interaction journey did not reduce its human steps");
  }
  console.log(
    `interaction_contract=PASS actions=${interactionContract.actionIds.length} journeys=${interactionContract.journeys.length} feedback_budget_ms=100 double_submit=blocked readback=required`,
  );

  for (const { label } of destinationRoutes) {
    const nav = page.locator("nav[aria-label='Áreas do Control Center'] a", { hasText: label });
    const count = await nav.count();
    if (count < 1) throw new Error(`missing nav label ${label}`);
  }
  console.log(`nav_labels=${destinationRoutes.length}`);

  const brand = await assertBrand(page);
  console.log(
    `brand_logo=loaded src=${brand.src} natural=${brand.naturalWidth}x${brand.naturalHeight} rendered=${Math.round(brand.width)}x${Math.round(brand.height)}`,
  );

  const dest = await page.locator("[data-destination]").getAttribute("data-destination");
  if (dest !== "hoje") throw new Error(`expected hoje, got ${dest}`);

  const attention = await page.locator(".attention").count();
  const priorities = await page.locator(".priority").count();
  if (attention < 1) throw new Error("Hoje has no attention items");
  if (priorities < 1 || priorities > 3) {
    throw new Error(`Hoje priorities out of range: ${priorities}`);
  }
  // Below-fold bands deliberately use content-visibility:auto. `innerText`
  // returns an empty string while the browser skips their paint, even though
  // the authored heading is present and becomes visible when scrolled near.
  const priorityHeading = await page.locator("#hoje-top3").textContent();
  const exceptionsHeading = await page.locator("#hoje-incidents").textContent();
  console.log(`hoje_priority_heading=${priorityHeading}`);
  console.log(`hoje_exceptions_heading=${exceptionsHeading}`);
  if (!priorityHeading.trim()) {
    throw new Error("missing Hoje priority heading");
  }
  if (!exceptionsHeading.trim()) {
    throw new Error("missing Exceções heading");
  }
  console.log(`hoje_attention=${attention}`);
  console.log(`hoje_priorities=${priorities}`);

  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`screenshot=${screenshotPath}`);

  const desktopCommercial = page.locator(
    "nav[aria-label='Áreas do Control Center'] a",
    { hasText: "Comercial" },
  );
  if (await desktopCommercial.isVisible()) {
    await desktopCommercial.click();
  } else {
    const moreTasks = page.locator(".task-nav-more > summary");
    await moreTasks.click();
    await page.locator("[data-task-nav='commercial']").click();
  }
  await page.waitForSelector('[data-destination="comercial"]');
  const after = await page.locator("[data-destination]").getAttribute("data-destination");
  if (after !== "comercial") throw new Error(`nav did not change destination: ${after}`);
  const heading = await page.locator("main h1").innerText();
  if (heading !== "Comercial") throw new Error(`heading ${heading}`);
  console.log(`nav_changed_to=${after}`);

  for (const id of destinations) {
    await page.goto(`${baseUrl}#/${id}`, { waitUntil: "networkidle" });
    await page.waitForSelector(`[data-destination="${id}"]`);
    const current = await page.locator("[data-destination]").getAttribute("data-destination");
    if (current !== id) throw new Error(`destination ${id} rendered ${current}`);
    const destFilled = await assertFilled(page, 40);
    console.log(`dest=${id} filled_chars=${destFilled.filled}`);
  }

  for (const hash of [...surfaceHashes, ...journeyHashes]) {
    await page.goto(`${baseUrl}#/${hash}`, { waitUntil: "networkidle" });
    const destFilled = await assertFilled(page, 40);
    console.log(`hash=${hash} filled_chars=${destFilled.filled}`);
  }

  const continuitySurfaces = await page.evaluate(() => {
    const surfaces = globalThis.__CONFENGE_CONTROL_CENTER__?.taskContinuity?.surfaces;
    return Array.isArray(surfaces) ? surfaces : null;
  });
  const requiredContinuityIds = ["messages", "inbound", "exceptions", "leads", "clients", "activities"];
  if (!continuitySurfaces
    || JSON.stringify(continuitySurfaces.map((surface) => surface.id)) !== JSON.stringify(requiredContinuityIds)) {
    throw new Error(`task-continuity surface contract is incomplete: ${JSON.stringify(continuitySurfaces)}`);
  }
  for (const viewport of [
    { name: "mobile-390", width: 390, height: 844 },
    { name: "desktop-1280", width: 1280, height: 800 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const surface of continuitySurfaces) {
      await page.goto(`${baseUrl}${surface.route}`, { waitUntil: "networkidle" });
      await page.waitForSelector(surface.selector);
      const state = await page.locator("[data-destination]").getAttribute("data-view-state");
      const matches = await page.locator(surface.selector).count();
      if (matches < 1) {
        throw new Error(
          `task-continuity ${surface.id} has no ${surface.selector} at ${surface.route} on ${viewport.name}`,
        );
      }
      console.log(
        `task_continuity surface=${surface.id} viewport=${viewport.name} state=${state} matches=${matches} route=${surface.route}`,
      );
    }
  }

  await page.goto(`${baseUrl}#/comercial/excecoes?q=owner&pagina=2`, { waitUntil: "networkidle" });
  await page.evaluate(() => history.replaceState(history.state, "", location.pathname));
  await page.reload({ waitUntil: "networkidle" });
  if (page.url().split("#")[1] !== "/comercial/excecoes?q=owner&pagina=2") {
    throw new Error(`task-continuity reload did not restore the bounded URL: ${page.url()}`);
  }
  console.log("task_continuity journey=reload result=restored");

  await page.evaluate(() => {
    const key = "confenge.control-center.task-continuity.v1";
    const stored = JSON.parse(sessionStorage.getItem(key) ?? "{}");
    sessionStorage.setItem(key, JSON.stringify({ ...stored, savedAt: Date.now() - (13 * 60 * 60 * 1000) }));
    history.replaceState(history.state, "", location.pathname);
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('[data-destination="hoje"]');
  if (page.url().split("#")[1] !== "/hoje") {
    throw new Error(`task-continuity expired state did not fall back to Hoje: ${page.url()}`);
  }
  console.log("task_continuity journey=expiry result=discarded");

  await page.goto(`${baseUrl}#/rota-inexistente?resource=lead-fixture-aurora`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-continuity-recovered="true"]');
  if (page.url().split("#")[1] !== "/hoje?continuity=recovered") {
    throw new Error(`task-continuity invalid route was not recovered: ${page.url()}`);
  }
  console.log("task_continuity journey=invalid-route result=recovered");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}#/comercial/rascunhos`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-review-workbench-count="55"]');
  const reviewListCount = await page.locator("[data-review-list-item]").count();
  const reviewInspectorCount = await page.locator("[data-review-inspector]").count();
  const reviewFormCount = await page.locator("[data-review-form]").count();
  if (reviewListCount !== 55 || reviewInspectorCount !== 1 || reviewFormCount !== 1) {
    throw new Error(
      `review workbench multiplied controls: rows=${reviewListCount} inspectors=${reviewInspectorCount} forms=${reviewFormCount}`,
    );
  }
  const reviewCoverage = await page.locator('[data-review-coverage="TOTAL_KNOWN"]').innerText();
  if (!reviewCoverage.includes("55 carregados de 55 no servidor") || !reviewCoverage.includes("0 restantes")) {
    throw new Error(`review coverage lost authoritative pagination: ${reviewCoverage}`);
  }
  if (await page.locator('[data-review-page="next"]').count() !== 0) {
    throw new Error("review workbench invented a next page after an authoritative end");
  }
  const approveLabel = await page.locator("[data-approve-submit]").innerText();
  if (!approveLabel.includes("Aprovar e agendar para contato-0@empresa-exemplo.test")) {
    throw new Error(`review primary action is not explicit: ${approveLabel}`);
  }
  const reviewOverflow = await page.evaluate(
    () => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  );
  if (reviewOverflow > 1) {
    throw new Error(`review workbench overflows 390px viewport by ${reviewOverflow}px`);
  }
  const reviewTitleBox = await page.locator("#rascunhos-title").boundingBox();
  const approveBox = await page.locator("[data-approve-submit]").boundingBox();
  if (!reviewTitleBox || !approveBox || approveBox.y - reviewTitleBox.y > 844) {
    throw new Error(
      `review primary action is more than one 390x844 viewport from the task heading: title=${JSON.stringify(reviewTitleBox)} approve=${JSON.stringify(approveBox)}`,
    );
  }
  const reviewShot = screenshotPath.replace(/(\.[a-z]+)$/i, "-review-workbench$1");
  await page.screenshot({ path: reviewShot, fullPage: true });
  console.log(
    `critical_path=review_list_to_inspector rows=${reviewListCount} forms=${reviewFormCount} viewport=390 overflow=${reviewOverflow} action_distance=${Math.round(approveBox.y - reviewTitleBox.y)} screenshot=${reviewShot}`,
  );

  // Critical operator journey (#65/#67): daily triage → detail → exception →
  // authorized sandbox action → receipt. Navigation into the detail is done
  // with Enter so a mouse-only implementation cannot satisfy this proof.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${baseUrl}#/comercial/atividade`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-activity-id="lead-fixture-aurora"]');
  const truthState = await page.locator("[data-operational-truth]").first().getAttribute("data-operational-truth");
  if (truthState !== "HEALTHY") {
    throw new Error(`complete daily-triage evidence should be HEALTHY, got ${truthState}`);
  }
  const activityLink = page.locator('[data-lead-detail-link="lead-fixture-aurora"]');
  await activityLink.focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-lead-detail="found"]');
  const detailText = await page.locator('[data-lead-detail="found"]').innerText();
  if (!detailText.includes("Metalúrgica Aurora") || !detailText.includes("Próximo passo")) {
    throw new Error("operator could not understand the lead from the detail surface");
  }
  console.log("critical_path=triage_to_detail keyboard=Enter result=found");

  // First prove the negative boundary: even a complete-looking row must not
  // expose a write when its truth receipt is absent. Intercept exactly one list
  // read; the following navigation uses the untouched production fixture.
  const exceptionsListPattern = "**/v1/domains/commercial/lists/exceptions**";
  await page.route(exceptionsListPattern, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const { truth: _omitted, ...withoutTruth } = body;
    await route.fulfill({ response, json: withoutTruth });
  }, { times: 1 });
  await page.goto(`${baseUrl}#/comercial/excecoes`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-exception-id="exception-fixture-owner"]');
  if ((await page.locator("[data-operational-truth]").count()) !== 0) {
    throw new Error("truth-less exception fixture unexpectedly rendered a truth receipt");
  }
  if ((await page.locator('[data-operator-form="START_EXCEPTION_WORK"]').count()) !== 0) {
    throw new Error("truth-less exception fixture exposed START_EXCEPTION_WORK");
  }
  const writesAllowedWithoutTruth = await page.locator('[data-list="excecoes"]').getAttribute("data-list-writes-allowed");
  if (writesAllowedWithoutTruth !== "false") {
    throw new Error(`truth-less exception fixture should block writes, got ${writesAllowedWithoutTruth}`);
  }
  const blockedCopy = await page.locator('[data-list="excecoes"] .banner.stale').first().innerText();
  if (!blockedCopy.includes("Ações bloqueadas")) {
    throw new Error(`truth-less exception fixture lacks blocking guidance: ${blockedCopy}`);
  }
  console.log("critical_path=exception_without_truth writes=blocked");
  await page.unroute(exceptionsListPattern);

  // The browser is already on this exact URL, so `goto` would be a same-document
  // no-op and would keep the intercepted truth-less DOM. Reload so the untouched
  // production fixture is really fetched with the route removed.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector('[data-exception-id="exception-fixture-owner"]');
  const exceptionTruth = await page.locator("[data-operational-truth]").first().getAttribute("data-operational-truth");
  if (exceptionTruth !== "HEALTHY") {
    throw new Error(`complete grouped exception payload should be HEALTHY, got ${exceptionTruth}`);
  }
  const grouped = await page.locator('[data-exception-id="exception-fixture-owner"]').getAttribute("data-occurrence-count");
  if (grouped !== "2") throw new Error(`grouped duplicate evidence lost: ${grouped}`);
  const action = page.locator('[data-operator-form="START_EXCEPTION_WORK"]');

  // A 390x844 phone with a reduced visual area stands in for an open virtual
  // keyboard. Native inline validation must retain the entered value, and the
  // field plus CTA must remain above the task launcher.
  await page.setViewportSize({ width: 390, height: 844 });
  const redundantFields = await page.locator(
    '[data-one-decision="true"] input:not([type="hidden"]), [data-one-decision="true"] textarea, [data-one-decision="true"] select',
  ).count();
  if (redundantFields !== 0) {
    throw new Error(`one-decision actions reintroduced ${redundantFields} redundant field(s)`);
  }
  const note = action.locator('textarea[name="note"]');
  const actionButton = action.locator('button[type="submit"]');
  await note.fill("x");
  await actionButton.click();
  const inlineValidation = await note.evaluate((field) => ({
    value: field.value,
    valid: field.checkValidity(),
    message: field.validationMessage,
  }));
  if (inlineValidation.valid || inlineValidation.value !== "x" || inlineValidation.message.length === 0) {
    throw new Error(`inline validation did not retain the invalid draft: ${JSON.stringify(inlineValidation)}`);
  }
  await page.setViewportSize({ width: 390, height: 520 });
  await note.focus();
  await actionButton.scrollIntoViewIfNeeded();
  const keyboardGeometry = await action.evaluate((form) => {
    const field = form.querySelector('textarea[name="note"]')?.getBoundingClientRect();
    const button = form.querySelector('button[type="submit"]')?.getBoundingClientRect();
    const nav = document.querySelector(".task-nav")?.getBoundingClientRect();
    const bottom = Math.min(globalThis.visualViewport?.height ?? innerHeight, nav?.top ?? innerHeight);
    return {
      field: field ? { top: field.top, bottom: field.bottom } : null,
      button: button ? { top: button.top, bottom: button.bottom } : null,
      usableBottom: bottom,
    };
  });
  if (!keyboardGeometry.field || !keyboardGeometry.button
    || keyboardGeometry.field.top < 0
    || keyboardGeometry.button.bottom > keyboardGeometry.usableBottom + 1) {
    throw new Error(`virtual-keyboard layout hides field or action: ${JSON.stringify(keyboardGeometry)}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  console.log(
    `interaction_mobile=PASS viewport=390x844 keyboard_simulated_height=520 redundant_fields=${redundantFields} validation=inline draft=preserved action=unobscured`,
  );

  await action.evaluate((form) => {
    globalThis.__CC_INTERACTION_PROBE__ = {};
    const probe = globalThis.__CC_INTERACTION_PROBE__;
    form.addEventListener("submit", () => {
      probe.submittedAt = performance.now();
    }, { capture: true, once: true });
    const observer = new MutationObserver(() => {
      if (form.getAttribute("aria-busy") !== "true" || probe.feedbackAt !== undefined) return;
      observer.disconnect();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          probe.feedbackAt = performance.now();
        });
      });
    });
    observer.observe(form, { attributes: true, attributeFilter: ["aria-busy"] });
  });
  await action.locator('textarea[name="note"]').fill("Fixture e2e: atribuir responsável e validar a origem");
  await actionButton.click();
  await page.waitForFunction(() => globalThis.__CC_INTERACTION_PROBE__?.feedbackAt !== undefined);
  const feedbackMs = await page.evaluate(() => {
    const probe = globalThis.__CC_INTERACTION_PROBE__;
    return probe.feedbackAt - probe.submittedAt;
  });
  if (!Number.isFinite(feedbackMs) || feedbackMs > 100) {
    throw new Error(`interaction feedback exceeded 100ms: ${feedbackMs}`);
  }
  await page.waitForSelector('.operator-result');
  if ((await page.locator('[data-action-receipt="true"]').count()) !== 1) {
    throw new Error(`authorized fixture action returned no receipt: ${await page.locator('.operator-result').innerText()}`);
  }
  const receiptText = await page.locator('[data-action-receipt="true"]').innerText();
  if (!receiptText.includes("founder-local") || !receiptText.includes("somente Control Center")) {
    throw new Error(`receipt lacks actor/write boundary: ${receiptText}`);
  }
  const criticalShot = screenshotPath.replace(/(\.[a-z]+)$/i, "-critical-path$1");
  await page.screenshot({ path: criticalShot, fullPage: true });
  console.log(`interaction_feedback=PASS budget_ms=100 measured_ms=${feedbackMs.toFixed(2)} double_submit=blocked readback=confirmed`);
  console.log(`critical_path=exception_to_receipt outcome=accepted screenshot=${criticalShot}`);

  async function overflowPx() {
    return page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
  }

  const matrixRoutes = routeInventory;
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${baseUrl}#/hoje`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-destination="hoje"][data-view-state="ready"]');
    const vpFilled = await assertFilled(page, 40);
    if (vpFilled.box.width < Math.min(300, vp.width - 24)) {
      throw new Error(`viewport ${vp.name} width ${vpFilled.box.width} too small for ${vp.width}`);
    }
    const overflow = await overflowPx();
    if (overflow > 1) {
      throw new Error(`viewport ${vp.name} accidental horizontal overflow ${overflow}px`);
    }
    const vpBrand = await assertBrand(page);
    const releaseIdentity = await page.locator('[data-runtime-identity="true"]').evaluate((footer) => ({
      sha: footer.getAttribute("data-release-sha") ?? "",
      label: footer.querySelector('[data-runtime-release-sha="true"]')?.textContent?.trim() ?? "",
      meta: document.querySelector('meta[name="cc-release-sha"]')?.getAttribute("content") ?? "",
    }));
    if (!/^[0-9a-f]{40}$/.test(releaseIdentity.sha)
      || releaseIdentity.sha !== releaseIdentity.label
      || releaseIdentity.sha !== releaseIdentity.meta) {
      throw new Error(`viewport ${vp.name}: runtime release identity diverged ${JSON.stringify(releaseIdentity)}`);
    }
    if (visualManifest.runtime_sha && visualManifest.runtime_sha !== releaseIdentity.sha) {
      throw new Error(`runtime release changed inside visual matrix: ${visualManifest.runtime_sha} -> ${releaseIdentity.sha}`);
    }
    visualManifest.runtime_sha = releaseIdentity.sha;
    console.log(
      `brand_logo viewport=${vp.name} rendered=${Math.round(vpBrand.width)}x${Math.round(vpBrand.height)}`,
    );
    console.log(`runtime_release viewport=${vp.name} sha=${releaseIdentity.sha}`);
    const metrics = await layoutMetrics(page);
    assertSingleScrollContext(metrics, `viewport ${vp.name}`);
    assertContentColumn(metrics, `viewport ${vp.name}`);
    const shotPath = screenshotPath.replace(/(\.[a-z]+)$/i, `-${vp.name}$1`);
    let shot = "skipped";
    if (!minimalEvidence || vp.name === "390" || vp.name === "desktop") {
      await page.screenshot({ path: shotPath, fullPage: true });
      shot = shotPath;
    }
    console.log(`viewport=${vp.name} screenshot=${shot} surface=${Math.round(vpFilled.box.width)}x${Math.round(vpFilled.box.height)} overflow=${overflow}`);
    console.log(
      `layout viewport=${vp.name} content_width=${metrics.contentWidth} gutters=${metrics.padLeft}/${metrics.padRight} dead_right=${metrics.deadRight} doc_scroll_range=${metrics.documentScrollRange} scroll_owners=${metrics.owners.map((o) => o.label).join("|") || "none"}`,
    );
    for (const route of matrixRoutes) {
      await page.goto(`${baseUrl}${route.hash}`, { waitUntil: "networkidle" });
      const hash = route.hash.replace(/^#\//, "");
      const surface = hash.includes("/") ? hash.split("/")[1] : null;
      if ((hash.startsWith("comercial/") || hash.startsWith("warmbly/")) && surface) {
        await page.waitForFunction(
          (wanted) => document.querySelector("[data-destination]")?.getAttribute("data-surface") === wanted,
          surface,
        );
      }
      const pageOverflow = await overflowPx();
      if (pageOverflow > 1) {
        throw new Error(`viewport ${vp.name} hash ${hash} accidental horizontal overflow ${pageOverflow}px`);
      }
      const hashMetrics = await layoutMetrics(page);
      assertSingleScrollContext(hashMetrics, `viewport ${vp.name} hash ${hash}`);
      assertContentColumn(hashMetrics, `viewport ${vp.name} hash ${hash}`);
      let axeViolations = "not-run";
      if (vp.visualGate) {
        axeViolations = await assertAxe(page, route.key, vp.name, "ready");
      }
      visualManifest.checks.push({
        kind: "geometry",
        route: route.key,
        viewport: vp.name,
        state: "ready",
        horizontal_overflow_px: pageOverflow,
        main_horizontal_overflow_px: hashMetrics.mainOverflowX,
        document_scroll_range_px: hashMetrics.documentScrollRange,
        competing_scroll_owners: hashMetrics.owners
          .filter((owner) => owner.isDocument || owner.insideMain)
          .map((owner) => owner.label),
      });
      let hashShot = "skipped";
      if (vp.matrixShots && !minimalEvidence) {
        hashShot = screenshotPath.replace(/(\.[a-z]+)$/i, `-${vp.name}-${route.key.replaceAll(":", "-")}$1`);
        await page.screenshot({ path: hashShot, fullPage: true });
      }
      console.log(
        `matrix viewport=${vp.name} route=${route.key} hash=${hash} overflow=${pageOverflow} axe_violations=${axeViolations} content_width=${hashMetrics.contentWidth} dead_right=${hashMetrics.deadRight} doc_scroll_range=${hashMetrics.documentScrollRange} screenshot=${hashShot}`,
      );
    }
  }

  const hojeRoute = routeInventory.find((route) => route.key === "destination:hoje");
  if (!hojeRoute) throw new Error("visual route inventory omitted Hoje");
  for (const vp of viewports.filter((viewport) => viewport.visualGate)) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const stateRoutes = vp.name === "390" ? routeInventory : [hojeRoute];
    for (const route of stateRoutes) {
      for (const kind of viewStates) {
        await page.goto(`${baseUrl}${route.hash}?view=${kind}`, { waitUntil: "networkidle" });
        await page.waitForFunction(
          (expected) =>
            document.querySelector("[data-destination]")?.getAttribute("data-view-state") ===
            expected,
          kind,
        );
        const kindState = await page.locator("[data-destination]").getAttribute("data-view-state");
        if (kindState !== kind) {
          throw new Error(`${vp.name}/${route.key} view ${kind} rendered data-view-state=${kindState}`);
        }
        const banner = await page.locator(".banner").count();
        if (banner < 1) throw new Error(`${vp.name}/${route.key} view ${kind} did not show a banner`);
        const stateOverflow = await overflowPx();
        if (stateOverflow > 1) {
          throw new Error(`${vp.name}/${route.key}/${kind} horizontal overflow ${stateOverflow}px`);
        }
        const stateMetrics = await layoutMetrics(page);
        assertSingleScrollContext(stateMetrics, `${vp.name}/${route.key}/${kind}`);
        const axeViolations = await assertAxe(page, route.key, vp.name, kind);
        let stateShot = "skipped";
        if (route.key === "destination:hoje" && !minimalEvidence) {
          stateShot = screenshotPath.replace(
            /(\.[a-z]+)$/i,
            `-${vp.name}-state-${kind}$1`,
          );
          await page.screenshot({ path: stateShot, fullPage: true });
        }
        visualManifest.checks.push({
          kind: "geometry",
          route: route.key,
          viewport: vp.name,
          state: kind,
          horizontal_overflow_px: stateOverflow,
          main_horizontal_overflow_px: stateMetrics.mainOverflowX,
          document_scroll_range_px: stateMetrics.documentScrollRange,
          competing_scroll_owners: stateMetrics.owners
            .filter((owner) => owner.isDocument || owner.insideMain)
            .map((owner) => owner.label),
        });
        console.log(
          `view_state_driven=${kind} viewport=${vp.name} route=${route.key} banner=${banner} axe_violations=${axeViolations} screenshot=${stateShot}`,
        );
      }
    }
  }

  let catalogComponentCount = 0;
  let catalogAxeChecks = 0;
  for (const vp of viewports.filter((viewport) => viewport.name === "390" || viewport.name === "desktop-1440")) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${baseUrl}#/hoje`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-destination="hoje"][data-view-state="ready"]');
    const catalogCoverage = await page.evaluate(() => {
      const designSystem = window.__CONFENGE_CONTROL_CENTER__?.designSystem;
      const main = document.querySelector("main");
      if (!designSystem || !main) throw new Error("operational design-system catalog is unavailable");
      main.innerHTML = designSystem.renderCatalog();
      const components = designSystem.components.map(({ id, selector }) => ({
        id,
        selector,
        matches: main.querySelectorAll(selector).length,
      }));
      const invalidActionBars = [...main.querySelectorAll('[data-operational-component="action-bar"]')]
        .filter((bar) => {
          const declared = Number.parseInt(bar.getAttribute("data-primary-actions") ?? "", 10);
          return (declared !== 0 && declared !== 1)
            || bar.querySelectorAll(".operational-primary-action").length !== declared;
        }).length;
      return {
        componentIds: components.map((component) => component.id),
        missing: components.filter((component) => component.matches < 1),
        invalidActionBars,
      };
    });
    if (catalogCoverage.componentIds.length !== 10 || catalogCoverage.missing.length > 0) {
      throw new Error(`operational component catalog coverage failed: ${JSON.stringify(catalogCoverage)}`);
    }
    if (catalogCoverage.invalidActionBars > 0) {
      throw new Error(`operational component catalog has ${catalogCoverage.invalidActionBars} invalid action bars`);
    }
    if (visualManifest.catalog.components.length > 0
      && JSON.stringify(visualManifest.catalog.components) !== JSON.stringify(catalogCoverage.componentIds)) {
      throw new Error("operational component catalog changed between viewports");
    }
    visualManifest.catalog.components = catalogCoverage.componentIds;
    catalogComponentCount = catalogCoverage.componentIds.length;
    const catalogOverflow = await overflowPx();
    if (catalogOverflow > 1) {
      throw new Error(`${vp.name}/component-catalog horizontal overflow ${catalogOverflow}px`);
    }
    const catalogMetrics = await layoutMetrics(page);
    assertSingleScrollContext(catalogMetrics, `${vp.name}/component-catalog`);
    assertContentColumn(catalogMetrics, `${vp.name}/component-catalog`);
    const axeViolations = await assertAxe(
      page,
      visualManifest.catalog.id,
      vp.name,
      visualManifest.catalog.state,
      visualManifest.catalog.checks,
    );
    catalogAxeChecks += 1;
    visualManifest.catalog.checks.push({
      kind: "geometry",
      route: visualManifest.catalog.id,
      viewport: vp.name,
      state: visualManifest.catalog.state,
      horizontal_overflow_px: catalogOverflow,
      main_horizontal_overflow_px: catalogMetrics.mainOverflowX,
      document_scroll_range_px: catalogMetrics.documentScrollRange,
      competing_scroll_owners: catalogMetrics.owners
        .filter((owner) => owner.isDocument || owner.insideMain)
        .map((owner) => owner.label),
    });
    const catalogShot = screenshotPath.replace(/(\.[a-z]+)$/i, `-component-catalog-${vp.name}$1`);
    await page.screenshot({ path: catalogShot, fullPage: true });
    console.log(`component_catalog viewport=${vp.name} components=${catalogComponentCount} overflow=${catalogOverflow} axe_violations=${axeViolations} screenshot=${catalogShot}`);
  }
  console.log(`component_catalog=PASS components=${catalogComponentCount} viewports=2 axe_checks=${catalogAxeChecks}`);

  if (errors.length > 0) {
    throw new Error(`page errors: ${errors.join(" | ")}`);
  }
  visualManifest.safety = networkSafetySnapshot();
  if (visualManifest.safety.unsafe_write_requests.length > 0
    || visualManifest.safety.allowed_local_control_center_writes.length !== 1
    || visualManifest.safety.observed_write_requests.length !== 1) {
    throw new Error(`visual gate network safety failed: ${JSON.stringify(visualManifest.safety)}`);
  }
  console.log("page_errors=0");
  visualManifest.result = "PASS";
  console.log(`visual_gate_manifest=${visualManifestPath}`);
  console.log("launch-probe ok");
} finally {
  visualManifest.safety = networkSafetySnapshot();
  visualManifest.completed_at = new Date().toISOString();
  writeFileSync(visualManifestPath, `${JSON.stringify(visualManifest, null, 2)}\n`);
  await browser.close();
}
