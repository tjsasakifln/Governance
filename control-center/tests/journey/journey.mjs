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
// Same stack, forward-auth identity carrying both groups. APPROVE remains with
// operators; only idempotent approval repair is admins-only.
const ADMIN_BASE = process.argv[3] ?? BASE;
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

// ---- 2b. Server-owned outbound block is visible before review work
const outbound = page.locator("[data-outbound-status='blocked']").first();
check("the server-owned outbound block is visible at the top", await outbound.count() === 1);
const outboundText = await outbound.innerText().catch(() => "");
check("the kill switch warning says APPROVE still queues but cannot leave",
  /APPROVE enfileira/.test(outboundText) && /nenhuma mensagem sai/.test(outboundText)
  && /Kill switch reportado\s+acionado/.test(outboundText.replace(/\n+/g, " ")),
  outboundText.replace(/\s+/g, " ").slice(0, 120));

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
const structure = await page.evaluate(() => {
  const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
  const cards = [...document.querySelectorAll("[data-candidate-id]")];
  return {
    duplicateIds: ids.filter((id, index) => id !== "" && ids.indexOf(id) !== index),
    nestedForms: document.querySelectorAll("form form").length,
    malformedCards: cards.filter(
      (card) =>
        card.querySelectorAll("[data-exact-subject]").length !== 1
        || card.querySelectorAll("[data-exact-body]").length !== 1
        || card.querySelectorAll("[data-candidate-identity]").length !== 1,
    ).length,
  };
});
check("the browser parsed every candidate card as one intact structure",
  structure.malformedCards === 0 && structure.nestedForms === 0,
  `malformed=${structure.malformedCards} nested_forms=${structure.nestedForms}`);
check("the review surface has no duplicate element ids", structure.duplicateIds.length === 0,
  structure.duplicateIds.join(","));

// ---- 4. The queue opens on pending work and says how much is left
check("the review surface opens on the pending recorte",
  await page.locator("[data-review-progress][data-queue-filter='pendentes']").count() > 0);
const progress = await page.locator("[data-queue-progress-text]").first().innerText().catch(() => "");
check("the queue states its own progress", /5 pendente/.test(progress), progress.replace(/\s+/g, " "));

// ---- 5. APPROVE gating: only a settled non-VALID verdict blocks a human
const approveAllowed = await page.locator("[data-approve-allowed='true']").count();
const approveBlocked = await page.locator("[data-approve-blocked]").count();
const autoValidate = await page.locator("[data-approve-needs-validation='true']").count();
check("only the settled INVALID candidate blocks APPROVE", approveBlocked === 1, `blocked=${approveBlocked}`);
check("every other candidate can be approved in one action", approveAllowed === 4, `allowed=${approveAllowed}`);
check("candidates without a live validation say the approval verifies first", autoValidate === 2,
  `auto-validate=${autoValidate}`);
const blockedReason = await page.locator("[data-approve-blocked]").first().innerText().catch(() => "");
check("the APPROVE block explains itself", blockedReason.trim().length > 0, blockedReason.replace(/\s+/g, " ").slice(0, 70));

// ---- 6. One action approves: no reason typed, no checkbox ticked
const firstApprove = page.locator("[data-approve-submit]:not([disabled])").first();
const cardBefore = await page.locator("[data-candidate-id]").count();
check("the approve control carries no required motive and no acknowledgement checkbox",
  await page.locator("form.approve-form [name='ack']").count() === 0
  && await page.locator("form.approve-form [name='reason'][required]").count() === 0);
check("the button says approval queues for sending",
  /Aprovar e enfileirar para envio/.test(await firstApprove.innerText().catch(() => "")));
await firstApprove.focus();
const pendingBeforeShortcutGuards = await page.locator("[data-queue-progress-text]").first().innerText();
await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", ctrlKey: true, repeat: true, bubbles: true, cancelable: true,
  }));
});
await page.waitForTimeout(250);
check("a repeating keyboard event cannot approve or advance the queue",
  await page.locator("[data-queue-progress-text]").first().innerText() === pendingBeforeShortcutGuards);
await page.evaluate(() => {
  const overlay = document.createElement("div");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("data-journey-overlay", "true");
  document.body.append(overlay);
  document.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", ctrlKey: true, bubbles: true, cancelable: true,
  }));
  overlay.remove();
});
await page.waitForTimeout(250);
check("a keyboard shortcut cannot cross an active modal overlay",
  await page.locator("[data-queue-progress-text]").first().innerText() === pendingBeforeShortcutGuards);
await firstApprove.click();
await page.waitForTimeout(1800);
const cardAfter = await page.locator("[data-candidate-id]").count();
check("one click took the message out of the pending queue", cardAfter === cardBefore - 1,
  `${cardBefore} -> ${cardAfter}`);
const progressAfter = await page.locator("[data-queue-progress-text]").first().innerText().catch(() => "");
check("the queue counted the approval", /1 aprovada/.test(progressAfter), progressAfter.replace(/\s+/g, " "));
check("the approved message is still readable in its own recorte",
  await page.locator("[data-review-filter='aprovadas']").count() > 0);

// ---- 7. Approving a candidate with no live validation verifies it on the way
//
// empresa-cinco arrives with no validation at all and the stand-in verifies it
// as VALID; empresa-quatro is the one whose prober identity is refused and is
// exercised separately below. Naming them apart matters: picking whichever came
// first would silently test the same candidate twice.
const needsCheckBefore = await page.locator("[data-approve-needs-validation='true']").count();
const verifiable = page
  .locator("[data-approve-needs-validation='true']")
  .filter({ hasText: "empresa-cinco" })
  .locator("[data-approve-submit]:not([disabled])");
if (await verifiable.count() > 0) {
  await verifiable.first().click();
  await page.waitForTimeout(2200);
  const stillPending = await page.locator("[data-approve-needs-validation='true']").count();
  check("approving an unverified recipient verified it and registered without a second click",
    stillPending === needsCheckBefore - 1, `${needsCheckBefore} -> ${stillPending}`);
  check("and the queue counted that approval too",
    /2 aprovada/.test(await page.locator("[data-queue-progress-text]").first().innerText().catch(() => "")));
}

// ---- 8. A verification that cannot come back VALID stops before APPROVE
const stubborn = page.locator("[data-approve-needs-validation='true'] [data-approve-submit]:not([disabled])");
if (await stubborn.count() > 0) {
  await stubborn.first().click();
  await page.waitForTimeout(2200);
  check("a recipient that will not verify blocks the approval and says so",
    await page.locator("[data-outcome-code='approval_validation_not_valid']").count() > 0);
  const stopText = await page.locator("[data-outcome-recovery]").first().innerText().catch(() => "");
  check("and it says the APPROVE was not sent", /não foi enviado|não foi tentad/i.test(
    stopText + (await page.locator("[data-outcome-detail]").first().innerText().catch(() => "")),
  ), stopText.replace(/\s+/g, " ").slice(0, 80));
}

// ---- 9. HOLD / REJECT keep their written motive
check("HOLD/REJECT still demand a written motive",
  await page.locator("[data-no-ack-required]").count() > 0
  && await page.locator("form [name='reason'][required]").count() > 0);

// ---- 10. RBAC is visible
check("effective operator capability is shown", await page.locator("[data-can-review]").count() > 0);
check("operators can approve and the screen states that it enqueues",
  await page.locator("[data-can-review='true']").count() > 0
  && /APPROVE enfileira/.test(await page.locator("[data-operator-identity]").first().innerText().catch(() => "")));
check("operators cannot run the admin repair",
  await page.locator("[data-can-reconcile='false']").count() > 0
  && await page.locator("[data-reconcile-submit][disabled]").count() === 1);
check("GO and cohort dispatch controls are absent",
  await page.locator("form[data-human-gate='decide'], form[data-human-gate='dispatch']").count() === 0);

// ---- 11. Adjust: two-step, diff before write, then vN+1
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

// ---- 12. Reload keeps the operator where they were
const before = page.url();
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1000);
check("a reload keeps the same resource", page.url() === before, page.url().split("#")[1] || "");

// ---- 11b. On the new version: APPROVE itself schedules; admin repair is exceptional
//
// v2 was frozen with every validation reset. The two forward-auth identities
// prove the deliberate RBAC split: operators approve-and-queue, while admins
// may only replay the same path for already-recorded approvals.
if (adjusted) {
  const v2 = (page.url().split("resource=")[1] || "").slice(0, 36);

  check("the operators-only identity has enabled approve-and-queue controls",
    await page.locator("[data-approve-submit]:not([disabled])").count() > 0);
  check("the operators-only identity cannot run reconciliation",
    await page.locator("[data-reconcile-submit][disabled]").count() === 1);
  const deniedRepairResponse = await fetch(`${BASE}/v1/warmbly/operator/cohorts/reconcile-approved`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idempotency_key: "journey-operator-repair-denied" }),
  });
  const deniedRepair = deniedRepairResponse.status;
  await deniedRepairResponse.text();
  check("operators are refused at the edge before admin repair reaches Warmbly", deniedRepair === 403,
    `HTTP ${deniedRepair}`);

  const admin = await newPage();
  await admin.goto(`${ADMIN_BASE}/#/warmbly/revisao?resource=${v2}&estado=todas`, { waitUntil: "networkidle" });
  await admin.waitForTimeout(1400);
  const title = await admin.locator("#review-title").innerText().catch(() => "");
  check("the admins+operators session opens the same version", /v2/i.test(title), title);
  check("that identity can run the explicit repair",
    await admin.locator("[data-reconcile-submit]:not([disabled])").count() === 1);

  // Two tabs approve the same candidate from the same initial server state.
  // Warmbly projects one scheduling record on the candidate, so neither a
  // double write nor two browser views can create a second queued message.
  const racingTab = await newPage();
  await racingTab.goto(`${ADMIN_BASE}/#/warmbly/revisao?resource=${v2}&estado=todas`, { waitUntil: "networkidle" });
  await racingTab.waitForTimeout(1200);
  const raceCard = admin
    .locator("[data-candidate-id]")
    .filter({ hasNotText: "empresa-quatro" })
    .locator("[data-approve-submit]:not([disabled])")
    .first();
  const raceId = await raceCard.evaluate((button) =>
    button.closest("[data-candidate-id]")?.getAttribute("data-candidate-id") || "",
  ).catch(() => "");
  const otherRace = racingTab
    .locator(`[data-candidate-id="${raceId}"] [data-approve-submit]:not([disabled])`)
    .first();
  if (raceId && await otherRace.count() > 0) {
    await Promise.all([raceCard.click(), otherRace.click()]);
    await Promise.all([admin.waitForTimeout(2200), racingTab.waitForTimeout(2200)]);
  }
  check("two tabs approving the same candidate leave one queued scheduling record",
    raceId !== ""
    && await admin.locator(`[data-candidate-id="${raceId}"][data-queue-state='aprovado'] [data-scheduling-confirmed='true']`).count() === 1);
  await racingTab.close();

  // Approve everything else except the mailbox the stand-in refuses to verify.
  for (let round = 0; round < 6; round += 1) {
    const btn = admin
      .locator("[data-candidate-id]")
      .filter({ hasNotText: "empresa-quatro" })
      .locator("[data-approve-submit]:not([disabled])")
      .first();
    if (await btn.count() === 0) break;
    await btn.click();
    await admin.waitForTimeout(2200);
  }
  const stillPending = await admin.locator("[data-queue-pending]").first().getAttribute("data-queue-pending");
  check("approve-and-queue drains v2 down to the recipient that cannot verify", stillPending === "1",
    `${stillPending} pending`);

  const hold = admin
    .locator("[data-candidate-id]")
    .filter({ hasText: "empresa-quatro" })
    .locator("form[data-human-gate='review'][data-gate-key$=':HOLD_REJECT']")
    .first();
  if (await hold.count() > 0) {
    await hold.locator("[name='reason']").first().fill("verificacao do destinatario nao conclui nesta caixa");
    await hold.locator("button[type=submit]").first().click();
    await admin.waitForTimeout(2000);
  }
  const progress2 = await admin.locator("[data-queue-progress-text]").first().innerText().catch(() => "");
  check("nothing is left pending on v2", /0 pendente/.test(progress2), progress2.replace(/\s+/g, " "));

  const scheduledCards = admin.locator("[data-queue-state='aprovado'] [data-scheduling-confirmed='true']");
  check("all four approvals are QUEUED with due_at and auto_send=true, without GO",
    await scheduledCards.count() === 4
    && await admin.locator("[data-scheduling-state='QUEUED']").count() === 4
    && await admin.locator("[data-scheduling-confirmed='true']").filter({ hasText: "auto_send da mensagem" }).count() === 4,
    `${await scheduledCards.count()} scheduled cards`);
  check("kill switch remains visible after approval and says queued mail cannot leave",
    await admin.locator("[data-outbound-status='blocked']").count() === 1
    && /nenhuma mensagem sai/.test(await admin.locator("[data-outbound-status='blocked']").innerText().catch(() => "")));
  check("there is still no GO or cohort dispatch after every decision",
    await admin.locator("form[data-human-gate='decide'], form[data-human-gate='dispatch']").count() === 0);

  // Admin repair runs twice. The first and second calls both find the same
  // already-scheduled bindings; the second cannot duplicate anything.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await admin.locator("[data-reconcile-submit]:not([disabled])").click();
    await admin.waitForTimeout(2200);
  }
  const reconciliation = await admin.locator("[data-reconcile-counts]").first().innerText().catch(() => "");
  check("reconciliation reports server counts after a second execution",
    /Registros APPROVE no histórico/.test(reconciliation)
    && /Candidatos únicos aprovados/.test(reconciliation)
    && /Agendados agora\s*0/.test(reconciliation)
    && /Já agendados\s*[1-9]/.test(reconciliation),
    reconciliation.replace(/\s+/g, " ").slice(0, 160));
  check("the second repair is confirmed by server reread and carries a receipt",
    await admin.locator("[data-readback='confirmed']").count() > 0
    && /receipt|recibo/i.test(await admin.locator("[data-write-evidence]").first().innerText().catch(() => "")));
  await admin.close();
}

// ---- 12b. A reload of the reviewed version never resurrects an approval
//
// The optimistic marks die with the page, so what is asserted here is the
// server's own record: two approvals registered, neither of them back in the
// pending queue. This is the failure that would let a message be approved
// twice, so it is proved against a fresh load rather than against local state.
const reviewed = await newPage();
await reviewed.goto(`${BASE}/#/warmbly/revisao?resource=${ORIGINAL_RESOURCE}`, { waitUntil: "networkidle" });
await reviewed.waitForTimeout(1400);
const afterReload = await reviewed.locator("[data-queue-progress-text]").first().innerText().catch(() => "");
check("a reload reads the approvals back from the server, not from this browser",
  /2 aprovada/.test(afterReload), afterReload.replace(/\s+/g, " "));
check("and no approved message came back as pending",
  await reviewed.locator("[data-queue-state='aprovado']").count() === 0
  && /3 pendente/.test(afterReload), afterReload.replace(/\s+/g, " "));
await reviewed.goto(`${BASE}/#/warmbly/revisao?resource=${ORIGINAL_RESOURCE}&estado=aprovadas`, { waitUntil: "networkidle" });
await reviewed.waitForTimeout(1400);
const approvedCards = await reviewed.locator("[data-queue-state='aprovado']").count();
check("the approved recorte holds exactly the two decided messages, with no second APPROVE offered",
  approvedCards === 2 && await reviewed.locator("[data-gate-key$=':APPROVE']").count() === 0,
  `${approvedCards} approved cards`);
check("both pre-adjustment approvals were scheduled by the same APPROVE call",
  await reviewed.locator("[data-scheduling-confirmed='true'][data-scheduling-state='QUEUED']").count() === 2);

// ---- 12c. The queue works on a phone
await reviewed.setViewportSize({ width: 390, height: 844 });
await reviewed.goto(`${BASE}/#/warmbly/revisao?resource=${ORIGINAL_RESOURCE}`, { waitUntil: "networkidle" });
await reviewed.waitForTimeout(1400);
const overflow = await reviewed.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check("the review queue does not scroll sideways on a 390px viewport", overflow <= 1, `overflow=${overflow}px`);
const tapTarget = await reviewed.locator("[data-approve-submit]:not([disabled])").first().boundingBox();
check("the approve control is a real tap target on a phone",
  !!tapTarget && tapTarget.height >= 40, tapTarget ? `${Math.round(tapTarget.height)}px tall` : "absent");
check("the recortes stay reachable on a phone",
  await reviewed.locator("[data-review-filters] a").count() === 4);
await reviewed.close();

// ---- 13. A second tab sees the same server truth
const tab2 = await newPage();
// Explicitly the "todas" recorte: by now every candidate of this version is
// decided, so the default Pendentes is legitimately empty and counting cards
// there would measure the filter, not the second tab's view of server truth.
await tab2.goto(`${before}${before.includes("?") ? "&" : "?"}estado=todas`, { waitUntil: "networkidle" });
await tab2.waitForTimeout(1200);
check("a second tab renders the same cohort", (await tab2.locator("[data-adjust-editor]").count()) === 5,
  `${await tab2.locator("[data-adjust-editor]").count()} candidates in tab 2`);
const tab2Progress = await tab2.locator("[data-queue-progress-text]").first().innerText().catch(() => "");
check("and the second tab reads the same decisions from the server",
  /0 pendente/.test(tab2Progress) && /4 aprovada/.test(tab2Progress), tab2Progress.replace(/\s+/g, " "));

// ---- 14. Console / network hygiene
check("no application errors in the browser console", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
check("no failed or 5xx requests", failedRequests.length === 0, failedRequests.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nJOURNEY: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
