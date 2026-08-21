/**
 * Headless launch of the previewed shell. Asserts the primary observable:
 * eight nav labels, Hoje attention + ≤3 priorities, nav changes destination.
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
  "clientes/acme",
];

const viewports = [
  { name: "360", width: 360, height: 800 },
  { name: "390", width: 390, height: 844 },
  { name: "430", width: 430, height: 932 },
  { name: "desktop", width: 1280, height: 800 },
];

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
    const shot = screenshotPath.replace(/(\.[a-z]+)$/i, `-${vp.name}$1`);
    await page.screenshot({ path: shot, fullPage: true });
    console.log(`viewport=${vp.name} screenshot=${shot} surface=${Math.round(vpFilled.box.width)}x${Math.round(vpFilled.box.height)} overflow=${overflow}`);
    for (const hash of matrixHashes) {
      await page.goto(`${baseUrl}#/${hash}`, { waitUntil: "networkidle" });
      const surface = hash.includes("/") ? hash.split("/")[1] : null;
      if (hash.startsWith("comercial")) {
        const expected = surface && surface !== "comercial" ? surface : "visao";
        await page.waitForFunction(
          (wanted) => document.querySelector("[data-destination]")?.getAttribute("data-surface") === wanted,
          expected,
        );
      }
      const pageOverflow = await overflowPx();
      if (pageOverflow > 1) {
        throw new Error(`viewport ${vp.name} hash ${hash} accidental horizontal overflow ${pageOverflow}px`);
      }
      const hashShot = screenshotPath.replace(/(\.[a-z]+)$/i, `-${vp.name}-${hash.replaceAll("/", "-")}$1`);
      await page.screenshot({ path: hashShot, fullPage: true });
      console.log(`matrix viewport=${vp.name} hash=${hash} overflow=${pageOverflow} screenshot=${hashShot}`);
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
