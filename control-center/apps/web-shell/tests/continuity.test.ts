import assert from "node:assert/strict";
import { test } from "node:test";
import { createMockAdapter } from "../src/adapters/mock";
import {
  operatorActionDraft,
  operatorActionDraftKey,
  resetOperatorActionDrafts,
} from "../src/action-draft";
import {
  bindOperatorActions,
  consumeQueueFocus,
  createMemoryRuntime,
  mount,
} from "../src/app";
import {
  CONTINUITY_END_FOCUS,
  CONTINUITY_FIRST_FOCUS,
  CONTINUITY_MAX_AGE_MS,
  CONTINUITY_STORAGE_KEY,
  CONTINUITY_SURFACE_CONTRACTS,
  actionContinuationHash,
  continuitySubrouteHref,
  durableContinuityHash,
  rememberContinuity,
  restoreContinuity,
  type ContinuityStorage,
} from "../src/continuity";
import { commercialSubnav } from "../src/ui/domains";
import { queueFocusDomId, queueFocusToken } from "../src/ui/lead-detail";

class MemoryStorage implements ContinuityStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

test("durable continuity stores route context but never typed or unsubmitted decisions", () => {
  const durable = durableContinuityHash(
    "#/comercial/atividade?q=metal&estado=open&ordem=recentes&pagina=3&por_pagina=25&resource=lead-7&pos=51&of=75&focus=qf-51-6-abc&view=stale&mode=edit&note=segredo&reason=segredo&subject=segredo&body=segredo&confirmation_token=segredo",
  );
  assert.equal(
    durable,
    "#/comercial/atividade?q=metal&estado=open&ordem=recentes&pagina=3&por_pagina=25&resource=lead-7&pos=51&of=75",
  );
  assert.equal(durableContinuityHash("#/rota-inexistente?q=x"), null);
  assert.equal(durableContinuityHash("#/clientes/acme-industria"), "#/clientes/acme-industria");
});

test("reload and reauthentication restore bounded context until explicit expiry", () => {
  const storage = new MemoryStorage();
  const now = Date.UTC(2026, 7, 25, 12, 0, 0);
  assert.equal(rememberContinuity(storage, "#/comercial/excecoes?q=owner&pagina=4&focus=queue-first", now), true);
  assert.equal(restoreContinuity(storage, now + 1_000), "#/comercial/excecoes?q=owner&pagina=4");
  assert.equal(restoreContinuity(storage, now + CONTINUITY_MAX_AGE_MS + 1), null);
  assert.equal(storage.getItem(CONTINUITY_STORAGE_KEY), null);

  storage.setItem(CONTINUITY_STORAGE_KEY, "not-json");
  assert.equal(restoreContinuity(storage, now), null);
  assert.equal(storage.getItem(CONTINUITY_STORAGE_KEY), null);
});

test("mount restores a session location and invalid deep links recover to Hoje", () => {
  const restoredRuntime = createMemoryRuntime("");
  let remembered = "";
  restoredRuntime.restoreHash = () => "#/comercial/atividade?q=inbound&pagina=2";
  restoredRuntime.rememberHash = (hash) => { remembered = hash; };
  const restoredRoot = { innerHTML: "" };
  const restored = mount(restoredRoot, createMockAdapter(), restoredRuntime);
  assert.equal(restoredRuntime.getHash(), "#/comercial/atividade?q=inbound&pagina=2");
  assert.match(restoredRoot.innerHTML, /data-destination="comercial"/);
  assert.equal(remembered, restoredRuntime.getHash());
  restored.unmount();

  const invalidRuntime = createMemoryRuntime("#/nao-existe?resource=lead-7");
  const invalidRoot = { innerHTML: "" };
  const invalid = mount(invalidRoot, createMockAdapter(), invalidRuntime);
  assert.equal(invalidRuntime.getHash(), "#/hoje?continuity=recovered");
  assert.match(invalidRoot.innerHTML, /data-continuity-recovered="true"/);
  invalid.unmount();
});

test("sibling routes preserve compatible filters and selection without carrying stale pages", () => {
  const current = "#/comercial/atividade?q=metal&estado=open&origem=warmbly&ordem=recentes&pagina=4&por_pagina=25&resource=lead-7&pos=76&of=120&focus=old";
  assert.equal(
    continuitySubrouteHref(current, "#/comercial/excecoes"),
    "#/comercial/excecoes?q=metal&estado=open&origem=warmbly&ordem=recentes&por_pagina=25&resource=lead-7",
  );
  const nav = commercialSubnav("atividade", current);
  assert.match(nav, /href="#\/comercial\/excecoes\?q=metal&amp;estado=open/);
  const exceptionHref = /href="([^"]+)" data-surface="excecoes"/.exec(nav)?.[1] ?? "";
  assert.doesNotMatch(exceptionHref, /pagina=4|pos=76|focus=old/);
  assert.equal(
    continuitySubrouteHref("#/warmbly/revisao?resource=cohort-9&estado=pendentes&mensagens=recolhidas", "#/warmbly/cohorts"),
    "#/warmbly/cohorts?estado=pendentes&resource=cohort-9&mensagens=recolhidas",
  );
});

test("a definitive queue action navigates to the next item and unknown stays put", async () => {
  resetOperatorActionDrafts();
  const next = queueFocusToken("exception-2", { index: 2, total: 4 });
  let listener: ((event: Event) => void) | undefined;
  const fields: Record<string, { value: string }> = {
    target_canonical_id: { value: "cc:exception:1" },
    target_source_id: { value: "exception-1" },
    note: { value: "iniciar tratamento" },
  };
  const form = {
    addEventListener(_type: string, handler: (event: Event) => void): void { listener = handler; },
    getAttribute(name: string): string | null {
      if (name === "data-operator-form") return "START_EXCEPTION_WORK";
      if (name === "data-continuity-action") return "queue";
      if (name === "data-continuity-next-focus") return next;
      return null;
    },
    querySelector(selector: string): { value: string } | null {
      const name = selector.match(/name="([^"]+)"/)?.[1] ?? "";
      return fields[name] ?? null;
    },
  };
  let navigated = "";
  let repainted = 0;
  let calls = 0;
  const submit = (): void => {
    const handler = listener;
    assert.ok(handler);
    handler({ preventDefault(): void {} } as Event);
  };
  bindOperatorActions(
    { innerHTML: "", querySelectorAll: () => [form] } as never,
    { operatorAction: async () => {
      calls += 1;
      return { ok: true, path: "/v1/operator-actions", kind: "nota", message: "registrado", outcome: "accepted" };
    } } as never,
    () => { repainted += 1; },
    (hash) => { navigated = hash; },
    "#/comercial/excecoes?q=owner&pagina=2",
  );
  submit();
  submit();
  assert.equal(calls, 1, "duplo submit durante o voo deve produzir uma única escrita");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(navigated, `#/comercial/excecoes?q=owner&pagina=2&focus=${next}`);
  assert.equal(repainted, 0);
  const draftKey = operatorActionDraftKey("START_EXCEPTION_WORK", "cc:exception:1", "exception-1");
  assert.equal(operatorActionDraft(draftKey), "", "receipt definitivo descarta a nota volátil");

  listener = undefined;
  navigated = "";
  bindOperatorActions(
    { innerHTML: "", querySelectorAll: () => [form] } as never,
    { operatorAction: async () => ({ ok: false, path: "/v1/operator-actions", kind: "nota", message: "sem resposta", outcome: "unknown" }) } as never,
    () => { repainted += 1; },
    (hash) => { navigated = hash; },
    "#/comercial/excecoes?q=owner&pagina=2",
  );
  submit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(navigated, "");
  assert.equal(repainted, 1);
  assert.equal(operatorActionDraft(draftKey), "iniciar tratamento", "unknown preserva a nota só em memória");
  resetOperatorActionDrafts();
});

test("queue focus supports next page, exact row and end-of-queue announcement", () => {
  const exactToken = queueFocusToken("row-1", { index: 1, total: 2 });
  let firstFocus = 0;
  let summaryFocus = 0;
  const first = {
    getAttribute(name: string): string | null {
      if (name === "id") return queueFocusDomId(exactToken);
      if (name === "data-queue-focus") return exactToken;
      return null;
    },
    focus(): void { firstFocus += 1; },
    scrollIntoView(): void {},
  };
  const summary = {
    getAttribute(): string | null { return null; },
    focus(): void { summaryFocus += 1; },
    scrollIntoView(): void {},
  };
  const root = {
    innerHTML: "",
    querySelectorAll(selector: string) {
      if (selector === "[data-queue-focus]") return [first];
      if (selector === "[data-list-count]") return [summary];
      return [];
    },
  };
  assert.equal(consumeQueueFocus(root as never, `#/comercial/atividade?focus=${CONTINUITY_FIRST_FOCUS}`, true, () => {}), true);
  assert.equal(firstFocus, 1);
  assert.equal(consumeQueueFocus(root as never, `#/comercial/atividade?focus=${CONTINUITY_END_FOCUS}`, true, () => {}), false);
  assert.equal(summaryFocus, 1);
  assert.equal(actionContinuationHash("#/comercial/atividade?resource=lead-1&pos=1&of=2&q=x", null), `#/comercial/atividade?q=x&focus=${CONTINUITY_END_FOCUS}`);
});

test("the global contract names every required operational queue family", () => {
  assert.deepEqual(
    CONTINUITY_SURFACE_CONTRACTS.map((surface) => surface.id),
    ["messages", "inbound", "exceptions", "leads", "clients", "activities"],
  );
  assert.equal(new Set(CONTINUITY_SURFACE_CONTRACTS.map((surface) => surface.route)).size, 6);
});
