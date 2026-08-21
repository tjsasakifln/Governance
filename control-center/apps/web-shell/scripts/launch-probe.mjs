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
  "Memória/Decisões",
  "Agentes",
];

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
  const box = await page.locator("#root").boundingBox();
  if (!box || box.width < 300 || box.height < 400) {
    throw new Error(`render surface too small: ${JSON.stringify(box)}`);
  }
  const filled = await page.locator("#root").evaluate((el) => el.innerText.length);
  if (filled < 80) {
    throw new Error(`render surface not substantially filled: ${filled} chars`);
  }
  console.log(`surface=${Math.round(box.width)}x${Math.round(box.height)}`);
  console.log(`filled_chars=${filled}`);

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
  const priorityHeading = await page.locator("#prioridades-title").innerText();
  const exceptionsHeading = await page.locator("#excecoes-title").innerText();
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

  if (errors.length > 0) {
    throw new Error(`page errors: ${errors.join(" | ")}`);
  }
  console.log("page_errors=0");
  console.log("launch-probe ok");
} finally {
  await browser.close();
}
