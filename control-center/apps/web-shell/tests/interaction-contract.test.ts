import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  bindExplicitSubmitKey,
  bindInteractionDraftCapture,
  bindOperatorActions,
} from "../src/app";
import {
  CRITICAL_INTERACTION_JOURNEYS,
  INTERACTION_FEEDBACK_BUDGET_MS,
  MUTABLE_INTERACTION_IDS,
  MUTABLE_INTERACTIONS,
} from "../src/interaction-contract";
import {
  interactionDraft,
  resetInteractionDrafts,
} from "../src/interaction-draft";

const here = dirname(fileURLToPath(import.meta.url));
const source = (name: string): string => readFileSync(join(here, "../src/ui", name), "utf8");

test("every mutable route is inventoried with consequence, derivation and recovery guarantees", () => {
  assert.equal(MUTABLE_INTERACTIONS.length, 27);
  assert.deepEqual(MUTABLE_INTERACTIONS.map((item) => item.id), MUTABLE_INTERACTION_IDS);
  assert.equal(new Set(MUTABLE_INTERACTIONS.map((item) => item.id)).size, MUTABLE_INTERACTIONS.length);
  for (const item of MUTABLE_INTERACTIONS) {
    assert.match(item.route, /^#\//, `${item.id} has no route`);
    assert.ok(item.action.length > 0, `${item.id} has no action`);
    assert.ok(item.consequence.length >= 20, `${item.id} has no concrete consequence`);
    assert.ok(item.derived.length > 0, `${item.id} derives no bookkeeping`);
    assert.ok(item.stepsAfter <= item.stepsBefore, `${item.id} adds steps`);
    assert.equal(item.feedbackBudgetMs, INTERACTION_FEEDBACK_BUDGET_MS);
    assert.equal(item.blocksDoubleSubmit, true);
    assert.equal(item.readback, true);
  }
});

test("irreversible actions keep proportional confirmation", () => {
  const irreversible = MUTABLE_INTERACTIONS.filter((item) => !item.reversible);
  assert.deepEqual(
    irreversible.map((item) => item.id),
    [
      "lead.warmbly-acknowledge",
      "draft.approve",
      "dispatch.resume",
      "gate.approve",
      "gate.reconcile",
    ],
  );
  assert.ok(irreversible.every((item) => item.confirmation !== "none"));
});

test("one-tap decisions never carry typed acknowledgements and high-risk gates stay explicit", () => {
  for (const item of MUTABLE_INTERACTIONS.filter((entry) => entry.humanDecision === "one-tap")) {
    assert.ok(item.confirmation === "none" || item.confirmation === "consequence", item.id);
    assert.equal(item.stepsAfter, 1, item.id);
  }
  const resume = MUTABLE_INTERACTIONS.find((item) => item.id === "dispatch.resume");
  assert.equal(resume?.confirmation, "two-step");
  assert.equal(resume?.humanDecision, "two-step");
  const adjust = MUTABLE_INTERACTIONS.find((item) => item.id === "gate.adjust");
  assert.ok(adjust?.derived.includes("version_confirmation"));
  assert.equal(adjust?.confirmation, "consequence");
});

test("critical journeys publish the measured before/after step reduction", () => {
  assert.deepEqual(CRITICAL_INTERACTION_JOURNEYS, [
    { id: "daily-triage", before: 3, after: 1 },
    { id: "exception-acknowledge", before: 3, after: 1 },
    { id: "inbound-acknowledge", before: 4, after: 1 },
    { id: "approve-and-queue", before: 2, after: 1 },
    { id: "adjust-version", before: 6, after: 5 },
  ]);
  assert.ok(CRITICAL_INTERACTION_JOURNEYS.every((journey) => journey.after < journey.before));
});

test("renderers cannot reintroduce redundant acknowledgements or copied bookkeeping", () => {
  const domains = source("domains.ts");
  const lead = source("lead-detail.ts");
  const warmbly = source("warmbly.ts");
  const alert = source("alert-card.ts");
  const all = `${domains}\n${lead}\n${warmbly}\n${alert}`;

  assert.doesNotMatch(all, /name="ciencia"|palavra_de_confirmacao|RECONHECER/);
  assert.doesNotMatch(warmbly, /name="confirmation"|data-approve-comment/);
  assert.match(warmbly, /name="limit" type="number" min="1" max="10"/);
  assert.doesNotMatch(warmbly, /data-warmbly-dispatch="acknowledge"/,
    "the global cockpit must not ask the operator to type an unproven target");
  assert.match(lead, /data-warmbly-dispatch="acknowledge"[\s\S]*data-one-decision="true"/);
});

test("explicit-submit protection keeps textarea newlines but blocks text-field Enter", () => {
  let listener: ((event: Event) => void) | undefined;
  bindExplicitSubmitKey({
    getAttribute: () => "true",
    addEventListener: (_type, bound) => { listener = bound; },
  });
  const press = (matches: (selector: string) => boolean): boolean => {
    let prevented = false;
    listener?.({
      key: "Enter",
      target: { matches },
      preventDefault: () => { prevented = true; },
    } as unknown as Event);
    return prevented;
  };
  assert.equal(press((selector) => selector.includes("textarea")), false);
  assert.equal(press(() => false), true);
  assert.equal(press((selector) => selector.includes('button[type="submit"]')), false);
});

test("live draft capture preserves unsent text before another action repaints", () => {
  resetInteractionDrafts();
  const listeners = new Map<string, (event: Event) => void>();
  const note = {
    value: "plano ainda não enviado",
    getAttribute: (name: string) => name === "name" ? "note" : null,
  };
  const form = {
    getAttribute: (name: string) => name === "data-draft-key" ? "operator:live" : null,
    addEventListener: (type: string, listener: (event: Event) => void) => { listeners.set(type, listener); },
    querySelector: () => null,
    querySelectorAll: () => [note],
  };
  bindInteractionDraftCapture({
    innerHTML: "",
    querySelectorAll: () => [form],
  } as never);
  listeners.get("input")?.({} as Event);
  assert.equal(interactionDraft("operator:live")?.note, "plano ainda não enviado");
});

class Control {
  value: string;
  disabled = false;
  textContent: string | null = null;
  constructor(value = "") {
    this.value = value;
  }
}

class OperatorForm {
  private listener: ((event: Event) => void) | undefined;
  readonly attributes = new Map<string, string>([
    ["data-operator-form", "START_EXCEPTION_WORK"],
    ["data-draft-key", "operator:test"],
  ]);
  readonly fields: Record<string, Control> = {
    target_canonical_id: new Control("cc:exception:1"),
    target_source_id: new Control("source-1"),
    note: new Control("preservar este plano"),
  };
  readonly button = new Control();

  addEventListener(_type: string, listener: (event: Event) => void): void {
    this.listener = listener;
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  querySelector(selector: string): Control | null {
    if (selector === 'button[type="submit"]') return this.button;
    const match = selector.match(/\[name="([^"]+)"\]/);
    return match ? this.fields[match[1]!] ?? null : null;
  }
  querySelectorAll(): Control[] {
    return [...Object.values(this.fields), this.button];
  }
  submit(): void {
    this.listener?.({ preventDefault(): void {} } as Event);
  }
}

test("operator actions paint pending synchronously, block double submit and preserve failed input", async () => {
  resetInteractionDrafts();
  const form = new OperatorForm();
  let calls = 0;
  let finish!: (value: { ok: false; path: string; kind: "nota"; message: string }) => void;
  const pending = new Promise<{ ok: false; path: string; kind: "nota"; message: string }>((resolve) => {
    finish = resolve;
  });
  const adapter = {
    operatorAction: () => {
      calls += 1;
      return pending;
    },
  };
  let repaints = 0;
  bindOperatorActions({ innerHTML: "", querySelectorAll: () => [form] } as never, adapter as never, () => {
    repaints += 1;
  });

  form.submit();
  form.submit();
  assert.equal(form.attributes.get("aria-busy"), "true", "feedback must precede the promise");
  assert.equal(form.button.disabled, true);
  assert.equal(form.button.textContent, "Registrando…");
  await Promise.resolve();
  assert.equal(calls, 1, "a second submit while pending must be ignored");

  finish({ ok: false, path: "/v1/operator-actions", kind: "nota", message: "validation failed" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(repaints, 1);
  assert.equal(interactionDraft("operator:test")?.note, "preservar este plano");
});
