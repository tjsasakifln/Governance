/**
 * Headless launch of the previewed shell. Asserts the primary observable:
 * every nav label, Hoje attention + ≤3 priorities, nav changes destination.
 *
 * Usage: node scripts/launch-probe.mjs <baseUrl> <screenshotPath>
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  const require = createRequire(import.meta.url);
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

const labels = [
  "Hoje",
  "Comercial",
  "Operação Warmbly",
  "Clientes",
  "Financeiro",
  "Engenharia",
  "Infra",
  "Crescimento",
  "Memória/Decisões",
  "Agentes",
];

const destinations = [
  "hoje",
  "comercial",
  "warmbly",
  "clientes",
  "financeiro",
  "engenharia",
  "infra",
  "crescimento",
  "memoria",
  "agentes",
];

const extraHashes = [
  "comercial/cohorts",
  "comercial/atividade",
  "comercial/pipeline",
  "comercial/excecoes",
  "warmbly/operacao",
  "clientes/acme",
];
const minimalEvidence = process.env.CC_EVIDENCE_MINIMAL === "1";

/**
 * `matrixShots: false` keeps the per-hash overflow/layout assertions but stops
 * writing a full-page screenshot per hash, so the three desktop resolutions
 * required by the layout acceptance criteria do not triple the artifact size.
 */
const viewports = [
  { name: "360", width: 360, height: 800, matrixShots: true },
  { name: "390", width: 390, height: 844, matrixShots: true },
  { name: "430", width: 430, height: 932, matrixShots: true },
  { name: "desktop", width: 1280, height: 800, matrixShots: true },
  { name: "desktop-1366", width: 1366, height: 768, matrixShots: false },
  { name: "desktop-1440", width: 1440, height: 900, matrixShots: false },
  { name: "desktop-1920", width: 1920, height: 1080, matrixShots: false },
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

const viewStates = ["loading", "error", "stale", "empty"];

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
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("crash", () => errors.push("page crashed"));

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
    const owners = [];
    for (const el of document.querySelectorAll("html, body, *")) {
      const style = getComputedStyle(el);
      if (style.overflowY !== "auto" && style.overflowY !== "scroll") continue;
      if (el.scrollHeight - el.clientHeight <= 1) continue;
      const tag = el.tagName.toLowerCase();
      const label = tag + (el.id ? `#${el.id}` : "") + (el.className ? `.${String(el.className).trim().split(/\s+/).join(".")}` : "");
      owners.push({ label, insideMain: main.contains(el) && el !== main, isMain: el === main, isDocument: tag === "html" || tag === "body" });
    }
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
    throw new Error(`${where}: content column clips ${m.mainOverflowX}px horizontally`);
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

  for (const label of labels) {
    const nav = page.locator("nav[aria-label='Áreas do Control Center'] a", { hasText: label });
    const count = await nav.count();
    if (count < 1) throw new Error(`missing nav label ${label}`);
  }
  console.log(`nav_labels=${labels.length}`);

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
  const priorityHeading = await page.locator("#hoje-top3").innerText();
  const exceptionsHeading = await page.locator("#hoje-incidents").innerText();
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

  await page.locator("nav[aria-label='Áreas do Control Center'] a", { hasText: "Comercial" }).click();
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

  for (const hash of extraHashes) {
    await page.goto(`${baseUrl}#/${hash}`, { waitUntil: "networkidle" });
    const destFilled = await assertFilled(page, 40);
    console.log(`hash=${hash} filled_chars=${destFilled.filled}`);
  }

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

  await page.goto(`${baseUrl}#/comercial/excecoes`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-exception-id="exception-fixture-owner"]');
  const exceptionTruth = await page.locator("[data-operational-truth]").first().getAttribute("data-operational-truth");
  if (exceptionTruth !== "UNKNOWN") {
    throw new Error(`partial grouped exception payload should be UNKNOWN, got ${exceptionTruth}`);
  }
  const grouped = await page.locator('[data-exception-id="exception-fixture-owner"]').getAttribute("data-occurrence-count");
  if (grouped !== "2") throw new Error(`grouped duplicate evidence lost: ${grouped}`);
  const action = page.locator('[data-operator-form="START_EXCEPTION_WORK"]');
  await action.locator('textarea[name="note"]').fill("Fixture e2e: atribuir responsável e validar a origem");
  await action.locator('button[type="submit"]').click();
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
  console.log(`critical_path=exception_to_receipt outcome=accepted screenshot=${criticalShot}`);

  async function overflowPx() {
    return page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
  }

  const matrixHashes = [...destinations.map((id) => id), ...extraHashes];
  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${baseUrl}#/hoje`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-destination="hoje"]');
    const vpFilled = await assertFilled(page, 40);
    if (vpFilled.box.width < Math.min(300, vp.width - 24)) {
      throw new Error(`viewport ${vp.name} width ${vpFilled.box.width} too small for ${vp.width}`);
    }
    const overflow = await overflowPx();
    if (overflow > 1) {
      throw new Error(`viewport ${vp.name} accidental horizontal overflow ${overflow}px`);
    }
    const vpBrand = await assertBrand(page);
    console.log(
      `brand_logo viewport=${vp.name} rendered=${Math.round(vpBrand.width)}x${Math.round(vpBrand.height)}`,
    );
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
    for (const hash of matrixHashes) {
      await page.goto(`${baseUrl}#/${hash}`, { waitUntil: "networkidle" });
      const surface = hash.includes("/") ? hash.split("/")[1] : null;
      if (hash.startsWith("comercial/") && surface) {
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
      let hashShot = "skipped";
      if (vp.matrixShots && !minimalEvidence) {
        hashShot = screenshotPath.replace(/(\.[a-z]+)$/i, `-${vp.name}-${hash.replaceAll("/", "-")}$1`);
        await page.screenshot({ path: hashShot, fullPage: true });
      }
      console.log(
        `matrix viewport=${vp.name} hash=${hash} overflow=${pageOverflow} content_width=${hashMetrics.contentWidth} dead_right=${hashMetrics.deadRight} doc_scroll_range=${hashMetrics.documentScrollRange} screenshot=${hashShot}`,
      );
    }
  }

  for (const kind of viewStates) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate((hash) => {
      window.location.hash = hash;
    }, `#/hoje?view=${kind}`);
    await page.waitForFunction(
      (expected) =>
        document.querySelector('[data-destination="hoje"]')?.getAttribute("data-view-state") ===
        expected,
      kind,
    );
    const kindState = await page.locator("[data-destination]").getAttribute("data-view-state");
    if (kindState !== kind) {
      throw new Error(`view ${kind} rendered data-view-state=${kindState}`);
    }
    const banner = await page.locator(".banner").count();
    if (banner < 1) throw new Error(`view ${kind} did not show a banner`);
    console.log(`view_state_driven=${kind} banner=${banner}`);
  }

  if (errors.length > 0) {
    throw new Error(`page errors: ${errors.join(" | ")}`);
  }
  console.log("page_errors=0");
  console.log("launch-probe ok");
} finally {
  await browser.close();
}
