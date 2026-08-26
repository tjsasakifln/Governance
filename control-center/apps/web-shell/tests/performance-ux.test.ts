import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  acknowledgeInteraction,
  installImmediateInteractionFeedback,
  INTERACTION_FEEDBACK_HOLD_MS,
  type FeedbackScheduler,
} from "../src/performance-ux";

class Target {
  attributes = new Map<string, string>();

  constructor(
    private readonly actionable: boolean,
    readonly tagName = "BUTTON",
    readonly type = "button",
  ) {}

  closest(): Target | null {
    return this.actionable ? this : null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

test("pointer receipt is synchronous and remains visible for a paint window", () => {
  const target = new Target(true);
  const scheduled: Array<{ delay: number; callback: () => void }> = [];
  const scheduler: FeedbackScheduler = {
    after: (delay, callback) => scheduled.push({ delay, callback }),
  };
  assert.equal(acknowledgeInteraction({ target }, scheduler), true);
  assert.equal(target.attributes.get("data-interaction-received"), "true");
  assert.equal(scheduled[0]?.delay, INTERACTION_FEEDBACK_HOLD_MS);
  scheduled[0]?.callback();
  assert.equal(target.attributes.has("data-interaction-received"), false);
});

test("feedback listens to pointer and keyboard but ignores text entry", () => {
  const listeners = new Map<string, (event: { target: unknown; key?: string }) => void>();
  const doc = {
    addEventListener(type: string, listener: (event: { target: unknown; key?: string }) => void): void {
      listeners.set(type, listener);
    },
  };
  const scheduler: FeedbackScheduler = { after: () => undefined };
  installImmediateInteractionFeedback(doc, scheduler);
  assert.deepEqual([...listeners.keys()], ["pointerdown", "keydown"]);
  const target = new Target(true);
  listeners.get("keydown")?.({ target, key: "a" });
  assert.equal(target.attributes.size, 0);
  listeners.get("keydown")?.({ target, key: "Enter" });
  assert.equal(target.attributes.get("data-interaction-received"), "true");

  for (const editable of [new Target(true, "INPUT", "text"), new Target(true, "TEXTAREA", "")]) {
    listeners.get("keydown")?.({ target: editable, key: " " });
    listeners.get("keydown")?.({ target: editable, key: "Enter" });
    assert.equal(editable.attributes.size, 0);
    listeners.get("pointerdown")?.({ target: editable });
    assert.equal(editable.attributes.get("data-interaction-received"), "true");
  }
});

test("initial HTML carries useful loading hierarchy before JavaScript", () => {
  const app = join(dirname(fileURLToPath(import.meta.url)), "..");
  const html = readFileSync(join(app, "index.html"), "utf8");
  assert.match(html, /data-boot-shell="true"/);
  assert.match(html, /role="status"/);
  assert.match(html, /<h1>Carregando o recorte atual/);
  assert.ok(html.indexOf("data-boot-shell") < html.indexOf('src=".\/src\/main.ts"'));
});

test("performance budget owns exact mobile targets and critical routes", () => {
  const app = join(dirname(fileURLToPath(import.meta.url)), "..");
  const budget = JSON.parse(readFileSync(join(app, "performance-budgets.json"), "utf8"));
  assert.deepEqual(budget.simulation.viewport, { width: 390, height: 844 });
  assert.equal(budget.budgets.interaction_feedback_ms, 100);
  assert.equal(budget.budgets.navigation_structure_ms, 200);
  assert.equal(budget.budgets.inp_p75_ms, 200);
  assert.equal(budget.budgets.lcp_p75_ms, 2500);
  assert.equal(budget.budgets.cls_p75, 0.1);
  assert.equal(budget.budgets.long_task_max_ms, 350);
  assert.equal(budget.budgets.initial_request_count, 16);
  assert.equal(budget.budgets.css_raw_bytes, 30000);
  assert.equal(budget.budgets.css_gzip_bytes, 6700);
  assert.equal(budget.budgets.bundle_gzip_bytes, 130000);
  assert.equal(budget.budgets.javascript_gzip_bytes, 123000);
  assert.equal(budget.budget_change.previous_bundle_gzip_bytes, 123500);
  assert.match(budget.budget_change.reason, /outbound runway/);
  assert.deepEqual(budget.routes.map((route: { id: string }) => route.id), ["hoje", "rascunhos", "coortes"]);
  const probe = readFileSync(join(app, "scripts/performance-probe.mjs"), "utf8");
  assert.match(probe, /performance_event_timing/);
  assert.match(probe, /interaction_to_structure_proxy/);
  assert.match(probe, /inp_sources/);
});
