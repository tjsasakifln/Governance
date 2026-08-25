#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

function chromiumFrom(mod) {
  const chromium = mod?.chromium ?? mod?.default?.chromium;
  return chromium && typeof chromium.launch === "function" ? chromium : null;
}

async function loadPlaywright() {
  try {
    const local = chromiumFrom(await import("playwright"));
    if (local) return local;
  } catch {
    // Fall through to the Playwright version installed by the e2e workflow.
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

function percentile75(values) {
  if (values.length === 0) throw new Error("cannot calculate p75 without samples");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.75) - 1];
}

function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");
const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("usage: node scripts/performance-probe.mjs <baseUrl>");
  process.exit(2);
}
const config = JSON.parse(readFileSync(join(app, "performance-budgets.json"), "utf8"));
const simulation = config.simulation;
const budgets = config.budgets;
const cachedChrome = join(homedir(), ".cache/ms-playwright/chromium-1234/chrome-linux64/chrome");
const launchOptions = { headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
if (existsSync(cachedChrome)) launchOptions.executablePath = cachedChrome;

const chromium = await loadPlaywright();
const browser = await chromium.launch(launchOptions);
const routeSamples = new Map(config.routes.map((route) => [route.id, []]));
const errors = [];

try {
  for (const route of config.routes) {
    for (let sampleIndex = 0; sampleIndex < simulation.samples_per_route; sampleIndex += 1) {
      const context = await browser.newContext({ viewport: simulation.viewport, serviceWorkers: "block" });
      const page = await context.newPage();
      const client = await context.newCDPSession(page);
      await client.send("Network.enable");
      await client.send("Network.setCacheDisabled", { cacheDisabled: true });
      await client.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: simulation.latency_ms,
        downloadThroughput: simulation.download_kbps * 1024 / 8,
        uploadThroughput: simulation.upload_kbps * 1024 / 8,
        connectionType: "cellular4g",
      });
      await client.send("Emulation.setCPUThrottlingRate", { rate: simulation.cpu_slowdown });

      await page.addInitScript(() => {
        window.__CC_PERFORMANCE_LAB__ = {
          lcp: 0,
          cls: 0,
          longTasks: [],
          events: [],
          bootStructureMs: null,
        };
        const lab = window.__CC_PERFORMANCE_LAB__;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) lab.lcp = Math.max(lab.lcp, entry.startTime);
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) lab.cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) lab.longTasks.push(entry.duration);
        }).observe({ type: "longtask", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.interactionId > 0) lab.events.push(entry.duration);
          }
        }).observe({ type: "event", buffered: true, durationThreshold: 16 });
        const bootObserver = new MutationObserver(() => {
          if (lab.bootStructureMs !== null) return;
          if (document.querySelector('[data-boot-shell="true"]')) {
            lab.bootStructureMs = performance.now();
            bootObserver.disconnect();
          }
        });
        bootObserver.observe(document, { childList: true, subtree: true });
        document.addEventListener("DOMContentLoaded", () => {
          if (document.querySelector('[data-boot-shell="true"]')) {
            lab.bootStructureMs = performance.now();
          }
        }, { once: true });
      });

      // Read-only fixture: this lets the critical review surface measure its
      // real rendering path without enabling its write endpoints.
      await page.route(/\/v1\/commercial\/review-drafts(?:\?|$)/, async (intercepted) => {
        await intercepted.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schema_version: "control-center.review-draft-page.v1",
            data: [{
              id: "00000000-0000-4000-8000-000000000001",
              account_id: "account-performance-lab",
              recipient: "performance-lab@empresa-exemplo.test",
              subject: "Revisão de desempenho percebido",
              body_text: "Mensagem sintética sem possibilidade de envio.",
              state: "NEEDS_REVIEW",
              purpose: "INITIAL",
              ordinal: 1,
              content_hash: "sha256:performance-lab",
              account: { nome_fantasia: "Empresa sintética" },
              fact_used: "Fato sintético para medição isolada",
              evidence_ids: ["evidence-performance-lab"],
              fact_source: "performance_lab",
              route_class: "GENERIC_COMPANY",
              editorial_state: "CURRENT",
              editorial_actionable: true,
            }],
            page: {
              limit: 100,
              offset: 0,
              loaded_count: 1,
              coverage_status: "TOTAL_KNOWN",
              total_count: 1,
              remaining_count: 0,
              has_more: false,
            },
          }),
        });
      });

      let requestCount = 0;
      page.on("request", () => { requestCount += 1; });
      const response = await page.goto(`${baseUrl}${route.hash}`, { waitUntil: "domcontentloaded", timeout: 15_000 });
      if (response?.status() !== 200) throw new Error(`${route.id}: cold load returned ${response?.status()}`);
      await page.waitForSelector("[data-destination][data-view-state]:not([data-view-state=loading])", { timeout: 10_000 });
      await page.waitForTimeout(250);

      const feedback = await page.evaluate(async () => {
        const actionable = document.querySelector("a[href], button:not([disabled]), summary");
        if (!actionable) throw new Error("no actionable element for feedback measurement");
        return await new Promise((resolve, reject) => {
          const started = performance.now();
          const observer = new MutationObserver(() => {
            if (actionable.getAttribute("data-interaction-received") !== "true") return;
            observer.disconnect();
            const style = getComputedStyle(actionable);
            resolve({ ms: performance.now() - started, painted: style.filter !== "none" || style.boxShadow !== "none" });
          });
          observer.observe(actionable, { attributes: true, attributeFilter: ["data-interaction-received"] });
          actionable.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
          setTimeout(() => {
            observer.disconnect();
            reject(new Error("interaction receipt was not painted"));
          }, 500);
        });
      });

      const target = route.id === "hoje"
        ? { task: "commercial", destination: "comercial" }
        : { task: "today", destination: "hoje" };
      if (target.task === "commercial") {
        await page.locator(".task-nav-more > summary").click();
      }
      const nav = page.locator(`[data-task-nav="${target.task}"]`).first();
      await nav.scrollIntoViewIfNeeded();
      await page.evaluate((destination) => {
        window.__CC_PERFORMANCE_LAB__.events = [];
        window.__CC_NAVIGATION_LAB__ = { started: null, finished: null };
        const lab = window.__CC_NAVIGATION_LAB__;
        document.addEventListener("click", () => {
          lab.started = performance.now();
          const observer = new MutationObserver(() => {
            if (document.querySelector(`[data-destination="${destination}"]`)) {
              lab.finished = performance.now();
              observer.disconnect();
            }
          });
          observer.observe(document.getElementById("root"), { childList: true, subtree: true });
        }, { capture: true, once: true });
      }, target.destination);
      await nav.click();
      await page.waitForSelector(`[data-destination="${target.destination}"]`);
      const navigationStructureMs = await page.evaluate(() => {
        const lab = window.__CC_NAVIGATION_LAB__;
        if (lab?.started === null || lab?.finished === null) throw new Error("navigation paint was not measured");
        return lab.finished - lab.started;
      });
      await page.waitForTimeout(150);
      await page.waitForFunction(
        () => window.__CC_PERFORMANCE_LAB__.events.length > 0,
        undefined,
        { timeout: 1_000 },
      ).catch(() => undefined);
      const metrics = await page.evaluate(() => {
        const lab = window.__CC_PERFORMANCE_LAB__;
        return {
          lcpMs: lab.lcp,
          cls: lab.cls,
          maxLongTaskMs: Math.max(0, ...lab.longTasks),
          inpMs: Math.max(0, ...lab.events),
          bootStructureMs: lab.bootStructureMs === null
            ? null
            : lab.bootStructureMs - performance.getEntriesByType("navigation")[0].responseStart,
        };
      });
      if (metrics.bootStructureMs === null) throw new Error(`${route.id}: static boot structure was not observed`);
      const rootChars = await page.locator("#root").evaluate((root) => root.textContent?.trim().length ?? 0);
      if (rootChars < 40) throw new Error(`${route.id}: shell became effectively empty (${rootChars} chars)`);

      routeSamples.get(route.id).push({
        lcp_ms: round(metrics.lcpMs),
        cls: round(metrics.cls, 4),
        inp_ms: round(metrics.inpMs > 0 ? metrics.inpMs : navigationStructureMs),
        inp_source: metrics.inpMs > 0 ? "performance_event_timing" : "interaction_to_structure_proxy",
        feedback_ms: round(feedback.ms),
        feedback_painted: feedback.painted,
        navigation_structure_ms: round(navigationStructureMs),
        boot_structure_ms: round(metrics.bootStructureMs),
        max_long_task_ms: round(metrics.maxLongTaskMs),
        request_count: requestCount,
      });
      await context.close();
    }
  }

  const routes = config.routes.map((route) => {
    const samples = routeSamples.get(route.id);
    const p75 = {
      lcp_ms: round(percentile75(samples.map((sample) => sample.lcp_ms))),
      cls: round(percentile75(samples.map((sample) => sample.cls)), 4),
      inp_ms: round(percentile75(samples.map((sample) => sample.inp_ms))),
      feedback_ms: round(percentile75(samples.map((sample) => sample.feedback_ms))),
      navigation_structure_ms: round(percentile75(samples.map((sample) => sample.navigation_structure_ms))),
      boot_structure_ms: round(percentile75(samples.map((sample) => sample.boot_structure_ms))),
      max_long_task_ms: round(percentile75(samples.map((sample) => sample.max_long_task_ms))),
      request_count: percentile75(samples.map((sample) => sample.request_count)),
    };
    const checks = {
      lcp: p75.lcp_ms <= budgets.lcp_p75_ms,
      cls: p75.cls <= budgets.cls_p75,
      inp: p75.inp_ms <= budgets.inp_p75_ms,
      feedback: p75.feedback_ms <= budgets.interaction_feedback_ms && samples.every((sample) => sample.feedback_painted),
      navigation_structure: p75.navigation_structure_ms <= budgets.navigation_structure_ms,
      long_task: p75.max_long_task_ms <= budgets.long_task_max_ms,
      requests: p75.request_count <= budgets.initial_request_count,
    };
    for (const [metric, pass] of Object.entries(checks)) {
      if (!pass) errors.push(`${route.id}:${metric}`);
    }
    console.log(`performance_route=${route.id} lcp_p75=${p75.lcp_ms} inp_p75=${p75.inp_ms} cls_p75=${p75.cls} feedback_p75=${p75.feedback_ms} nav_p75=${p75.navigation_structure_ms} requests_p75=${p75.request_count}`);
    return {
      ...route,
      samples,
      p75,
      inp_sources: [...new Set(samples.map((sample) => sample.inp_source))],
      checks,
      result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
    };
  });

  const report = {
    schema_version: "control-center.performance-lab-report.v1",
    release_sha: process.env.GITHUB_SHA || process.env.CC_RELEASE_SHA || "LOCAL",
    execution: "ISOLATED_AUTHENTICATED_MOBILE_LAB",
    canonical_environment_sampled: false,
    canonical_gap: "Cold load, navigation and authenticated action must still be sampled in the canonical environment before closing #112.",
    simulation,
    budgets,
    routes,
    safety: {
      real_email_sent: false,
      go_authorized: false,
      outbound_resumed: false,
      irreversible_action: false,
    },
    failures: errors,
    result: errors.length === 0 ? "PASS" : "FAIL",
  };
  if (process.env.CC_PERFORMANCE_LAB_REPORT) {
    writeFileSync(process.env.CC_PERFORMANCE_LAB_REPORT, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(`performance_lab=${report.result} routes=${routes.length} samples=${routes.reduce((sum, route) => sum + route.samples.length, 0)} canonical_sampled=false`);
  if (errors.length > 0) {
    console.error(`performance budget failures: ${errors.join(", ")}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
