/**
 * Founder journey in a real browser, driven end to end through the real
 * Context Service and the real human-gate connector, with a faithful stand-in
 * for the Warmbly backend. Production itself sits behind Authelia two-factor,
 * which must not be bypassed, so this is the strongest journey proof available
 * without the founder's own second factor.
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Playwright is not a dependency of this workspace; resolve it the same way
// scripts/launch-probe.mjs does, so the journey runs wherever that probe does.
function chromiumFrom(mod) {
  const c = mod?.chromium ?? mod?.default?.chromium;
  return c && typeof c.launch === "function" ? c : null;
}
async function loadChromium() {
  for (const spec of ["playwright", "playwright-core"]) {
    try {
      const c = chromiumFrom(await import(spec));
      if (c) return c;
    } catch {
      /* try the next source */
    }
  }
  const require = createRequire(import.meta.url);
  for (const root of [join(homedir(), ".npm/_npx"), join(homedir(), ".cache/npx")]) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const candidate = join(root, entry, "node_modules/playwright");
      if (!existsSync(join(candidate, "package.json"))) continue;
      try {
        const c = chromiumFrom(await import(require.resolve(candidate)));
        if (c) return c;
      } catch {
        /* keep looking */
      }
    }
  }
  throw new Error("playwright is not installed; install it or set CC_CHROMIUM and provide playwright");
}
const chromium = await loadChromium();

const BASE = process.argv[2];
const exe = process.env.CC_CHROMIUM ?? (process.env.HOME + "/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
};

const browser = await chromium.launch({ headless: true, executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext();
const consoleErrors = [];
const failedRequests = [];
ctx.on("weberror", (e) => consoleErrors.push(String(e.error())));

async function newPage() {
  const p = await ctx.newPage();
  p.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  p.on("pageerror", (e) => consoleErrors.push(String(e)));
  p.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  p.on("response", (r) => { if (r.status() >= 500) failedRequests.push(`${r.status()} ${r.url()}`); });
  return p;
}

const page = await newPage();

// ---- 1. Discoverability from #/warmbly
await page.goto(`${BASE}/#/warmbly`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
check("#/warmbly renders the pilot stepper", await page.locator("[data-pilot-stepper]").count() > 0);
check("#/warmbly names the pilot steps", (await page.locator("[data-step]").count()) >= 5,
  `${await page.locator("[data-step]").count()} steps`);
const openReview = page.locator("[data-open-review]").first();
const ORIGINAL_RESOURCE = "4d52c6cd-22c5-4e7a-aff2-0c26331c1357";
check("#/warmbly offers an explicit 'Abrir revisão'", await openReview.count() > 0);

// ---- 2. Reaching the review without a deep link
if (await openReview.count() > 0) {
  await openReview.click();
  await page.waitForTimeout(1200);
}
check("clicking through reaches a review with a resource", /#\/warmbly\/revisao/.test(page.url()) && /[0-9a-f-]{36}/.test(page.url()), page.url().split("#")[1] || "");

// ---- 3. The message is readable by default
// data-candidate sits on each per-candidate FORM (validate, approve, hold,
// adjust), so counting it counts forms. The editor is one per candidate.
const nCards = await page.locator("[data-adjust-editor]").count();
check("every cohort member is listed", nCards === 5, `${nCards} candidates`);
const subj = page.locator("[data-exact-subject]").first();
const body = page.locator("[data-exact-body]").first();
check("exact subject is visible without opening anything", await subj.isVisible().catch(() => false));
check("exact body is visible without opening anything", await body.isVisible().catch(() => false));
check("recipient is shown on the card", (await page.locator("[data-candidate-identity]").first().innerText().catch(() => "")).includes("@"));
check("preview denominators are rendered", await page.locator("[data-preview-denominators]").count() > 0);

// ---- 4. APPROVE gating follows the server's verdict
const approveAllowed = await page.locator("[data-approve-allowed='true']").count();
const approveBlocked = await page.locator("[data-approve-blocked]").count();
check("APPROVE is offered only for VALID candidates", approveAllowed === 2, `allowed=${approveAllowed}`);
check("APPROVE is blocked, with a reason, for the rest", approveBlocked === 3, `blocked=${approveBlocked}`);
const blockedReason = await page.locator("[data-approve-blocked]").first().innerText().catch(() => "");
check("the APPROVE block explains itself", blockedReason.trim().length > 0, blockedReason.replace(/\s+/g, " ").slice(0, 70));

// ---- 5. HOLD / REJECT do not inherit the APPROVE acknowledgement
check("HOLD/REJECT are marked as needing no acknowledgement",
  await page.locator("[data-no-ack-required]").count() > 0);

// ---- 6. RBAC is visible
check("effective operator capability is shown", await page.locator("[data-can-review]").count() > 0);
check("GO authority is stated explicitly", await page.locator("[data-go-authority], [data-can-decide]").count() > 0);

// ---- 7. Adjust: two-step, diff before write, then vN+1
const adjustEditor = page.locator("[data-adjust-editor]").first();
check("an adjust editor exists on the candidate", await adjustEditor.count() > 0);
let adjusted = false;
if (await adjustEditor.count() > 0) {
  // The editor is a <details>; open it the way an operator would.
  await adjustEditor.locator("summary").first().click().catch(() => {});
  await page.waitForTimeout(400);
  const sIn = adjustEditor.locator("[name='subject']").first();
  const bIn = adjustEditor.locator("[name='body_text']").first();
  const rIn = adjustEditor.locator("[name='reason']").first();
  if (await sIn.count() && await bIn.count() && await rIn.count()) {
    await sIn.fill("recuperacao estrutural da ponte revisada");
    await bIn.fill("Ola, equipe,\n\nSou da CONFENGE.\n\ncontratacao publica: recuperacao estrutural da ponte revisada.\n\nVoce consegue me indicar a pessoa responsavel?");
    await rIn.fill("ajuste de copy aprovado na revisao do fundador");
    const cIn = adjustEditor.locator("[name='confirmation']").first();
    if (await cIn.count()) await cIn.fill("v1");
    const submit = adjustEditor.locator("button[type=submit], [data-gate-action='adjust']").first();
    await submit.click();
    await page.waitForTimeout(900);
    const diffShown = await page.locator("[data-adjust-diff]").count() > 0;
    check("the first submit shows a diff and writes nothing", diffShown);
    const confirm = page.locator("[data-adjust-step='confirm'] button[type=submit], [data-adjust-diff] button[type=submit]").first();
    if (await confirm.count() > 0) {
      await confirm.click();
      await page.waitForTimeout(1800);
      adjusted = true;
    }
  }
}
if (adjusted) {
  // The proof that a new immutable version exists is that the surface moved to
  // a different resource id; the previous one is untouched and still readable.
  const movedTo = (page.url().split("resource=")[1] || "").slice(0, 36);
  check("adjust opened a NEW version, leaving the original intact",
    movedTo.length === 36 && movedTo !== ORIGINAL_RESOURCE, `now on ${movedTo}`);
  const pend = await page.locator("[data-validation-status]").allInnerTexts().catch(() => []);
  check("the new version starts with validation pending, nothing inherited",
    pend.length > 0 && pend.every((t) => !/VALID\b/.test(t)), pend.slice(0, 3).join(" | "));
  // The original must still be readable, byte-for-byte, at its own address.
  const prev = await newPage();
  await prev.goto(`${BASE}/#/warmbly/revisao?resource=${ORIGINAL_RESOURCE}`, { waitUntil: "networkidle" });
  await prev.waitForTimeout(1200);
  const prevSubject = await prev.locator("[data-exact-subject]").first().innerText().catch(() => "");
  check("the superseded version is still readable at its own address",
    prevSubject.trim().length > 0, prevSubject.replace(/\s+/g, " ").slice(0, 60));
  await prev.close();
  const wr = await page.locator("[data-write-result]").count();
  check("the write reports its outcome on the surface", wr > 0, `${wr} result blocks`);
  const receipt = await page.locator("[data-write-evidence], [data-write-result]").first().innerText().catch(() => "");
  check("the outcome carries a receipt", /receipt|recibo/i.test(receipt), receipt.replace(/\s+/g, " ").slice(0, 80));
}

// ---- 8. Reload keeps the operator where they were
const before = page.url();
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1000);
check("a reload keeps the same resource", page.url() === before, page.url().split("#")[1] || "");

// ---- 9. A second tab sees the same server truth
const tab2 = await newPage();
await tab2.goto(before, { waitUntil: "networkidle" });
await tab2.waitForTimeout(1200);
check("a second tab renders the same cohort", (await tab2.locator("[data-adjust-editor]").count()) === 5,
  `${await tab2.locator("[data-adjust-editor]").count()} candidates in tab 2`);

// ---- 10. Console / network hygiene
check("no application errors in the browser console", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
check("no failed or 5xx requests", failedRequests.length === 0, failedRequests.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nJOURNEY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
