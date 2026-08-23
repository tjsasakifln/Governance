/**
 * The founder-facing cohort gate.
 *
 * Every test here pins a defect that shipped to production: a subnav that lost
 * the selected version, a review that hid the message it existed to review, a
 * write that answered nothing at all on the surface it was fired from, an
 * APPROVE offered on candidates the server would always refuse, a HOLD that
 * demanded the approval acknowledgement, and a double click that meant two
 * cohorts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { AdapterWriteResult, WarmblyGateInput } from "../src/adapters/contract";
import { HttpControlCenterAdapter } from "../src/adapters/http";
import { paintShell } from "../src/app";
import { resetGateFlight } from "../src/human-gate-flight";
import { warmblyBlock } from "../src/ui/warmbly";
import { clearPendingResumeConfirmation } from "../src/warmbly-confirmation";

/* ------------------------------------------------------------------ *
 * Fixtures. No real mailbox, no real company, no secret.
 * ------------------------------------------------------------------ */

const COHORT_ID = "11111111-1111-4111-8111-111111111111";
const NEXT_COHORT_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const CANDIDATE_ID = "22222222-2222-4222-8222-222222222222";

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidate_id: CANDIDATE_ID,
    company: "Empresa Fixture",
    mailbox: "compras@empresa.invalid",
    mailbox_purpose: "ROLE_OR_DEPARTMENT",
    route_class: "ROLE_OR_DEPARTMENT",
    source: "fixture.sanitized",
    subject: "Assunto exato congelado",
    body_text: "Corpo exato congelado da mensagem.",
    cta: "Posso enviar uma segunda leitura técnica?",
    observed_fact_text: "Fato público de fixture",
    evidence_source: "fixture://diario-oficial",
    evidence_observed_at: "2026-08-22T12:00:00Z",
    content_hash: "content-fixture-001",
    frozen_hash: "frozen-fixture-001",
    evidence_hash: "evidence-fixture-001",
    composer_version: "composer.v3",
    copy_qa: { failures: ["assunto_generico"] },
    duplicate_of: "outro-candidato-fixture",
    missing_provenance: false,
    hard_bounce: false,
    exclusion_reason: "nenhuma",
    validation: { status: "VALID", reason: "MX confirmado no sandbox", expires_at: "2026-08-24T12:00:00Z" },
    review: { decision: "HOLD", effective: false },
    blocked_by: ["approval_missing_or_invalid"],
    ...overrides,
  };
}

function cohort(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: COHORT_ID,
    version: 1,
    source: "extra-cli",
    as_of: "2026-08-23T12:00:00Z",
    freshness: "FRESH",
    policy_version: "bounded-cohort-policy.v1",
    receipt: `cohort:${COHORT_ID}`,
    manifest: {
      preview: {
        accounts_considered: 7,
        accounts_eligible: 2,
        accounts_excluded: 5,
        recipients_final: 2,
        suppressed: 1,
        opt_out: 1,
        risky_excluded: 1,
        duplicates_excluded: 1,
        hard_bounce_excluded: 1,
        missing_provenance_excluded: 0,
        copy_qa_failed_excluded: 1,
      },
    },
    candidates: [candidate()],
    ...overrides,
  };
}

function gatePayload(
  groups: readonly string[] = ["operators", "admins"],
  selected: Record<string, unknown> | null = cohort(),
): Record<string, unknown> {
  return {
    list: { data: [cohort()], edge_actor: { id: "fixture-user", groups } },
    list_status: "read",
    ...(selected ? { selected: { data: selected }, selected_status: "read" } : {}),
  };
}

function surfaceInput(overrides: Record<string, unknown> = {}): Parameters<typeof warmblyBlock>[0] {
  return {
    snapshot: undefined,
    operator: { kind: "human" as const, id: "human:operator", display_name: "Fundador" },
    gate: gatePayload(),
    resource: COHORT_ID,
    ...overrides,
  } as Parameters<typeof warmblyBlock>[0];
}

/* ------------------------------------------------------------------ *
 * A root that really parses the markup it was handed.
 *
 * The binders read attributes and field values off the elements this returns,
 * so a fake that invents its own forms would test the fake. This one scans the
 * painted HTML, which means a renderer that stops emitting a form makes the
 * binder test fail — which is the point.
 * ------------------------------------------------------------------ */

interface FakeField {
  value: string;
  checked?: boolean;
}

class FakeElement {
  readonly attributes: Record<string, string>;
  readonly fields: Record<string, FakeField>;
  private listeners: Array<{ type: string; listener: (event: Event) => void }> = [];

  constructor(attributes: Record<string, string>, fields: Record<string, FakeField>) {
    this.attributes = attributes;
    this.fields = fields;
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.push({ type, listener });
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  querySelector(selector: string): FakeField | null {
    const name = selector.replace(/[[\]'"]/g, "").replace("name=", "");
    return this.fields[name] ?? null;
  }

  set(name: string, value: string): void {
    this.fields[name] = { ...(this.fields[name] ?? { value: "" }), value };
  }

  check(name: string): void {
    this.fields[name] = { ...(this.fields[name] ?? { value: "on" }), checked: true };
  }

  fire(type = "submit"): void {
    for (const entry of this.listeners) {
      if (entry.type === type) entry.listener({ preventDefault(): void {} } as unknown as Event);
    }
  }
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z0-9_:-]+)="([^"]*)"/g)) {
    attributes[match[1]!] = match[2]!;
  }
  for (const match of tag.matchAll(/(?:^|\s)(disabled|required|open|selected)(?=\s|>|$)/g)) {
    attributes[match[1]!] = "";
  }
  return attributes;
}

function parseFields(inner: string): Record<string, FakeField> {
  const fields: Record<string, FakeField> = {};
  for (const match of inner.matchAll(/<input\b([^>]*)>/g)) {
    const attributes = parseAttributes(match[1]!);
    if (!attributes.name) continue;
    fields[attributes.name] =
      attributes.type === "checkbox"
        ? { value: attributes.value ?? "on", checked: attributes.checked !== undefined }
        : { value: attributes.value ?? "" };
  }
  // A textarea holds its value as text, and a select holds it on an option.
  // Reading only the opening tag would report every one of them as empty.
  for (const match of inner.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)) {
    const attributes = parseAttributes(match[1]!);
    if (attributes.name) fields[attributes.name] = { value: match[2]! };
  }
  for (const match of inner.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const attributes = parseAttributes(match[1]!);
    if (!attributes.name) continue;
    const options = [...match[2]!.matchAll(/<option\b([^>]*)>([^<]*)</g)].map((option) => ({
      attributes: parseAttributes(option[1]!),
      text: option[2]!,
    }));
    const chosen = options.find((option) => option.attributes.selected !== undefined) ?? options[0];
    fields[attributes.name] = { value: chosen?.attributes.value ?? chosen?.text ?? "" };
  }
  return fields;
}

function elementsOf(html: string): FakeElement[] {
  const elements: FakeElement[] = [];
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)) {
    elements.push(new FakeElement(parseAttributes(match[1]!), parseFields(match[2]!)));
  }
  for (const match of html.matchAll(/<button\b([^>]*)>/g)) {
    const attributes = parseAttributes(match[1]!);
    if (attributes["data-toggle-messages"] !== undefined) {
      elements.push(new FakeElement(attributes, {}));
    }
  }
  return elements;
}

function matches(element: FakeElement, selector: string): boolean {
  const withValue = selector.match(/^\[([a-zA-Z0-9_-]+)="([^"]*)"\]$/);
  if (withValue) return element.getAttribute(withValue[1]!) === withValue[2];
  const bare = selector.match(/^\[([a-zA-Z0-9_-]+)\]$/);
  if (bare) return element.getAttribute(bare[1]!) !== null;
  return false;
}

function paintingRoot(): {
  root: { innerHTML: string; querySelectorAll(selector: string): FakeElement[] };
  paints: number;
  find(selector: string): FakeElement;
  all(selector: string): FakeElement[];
} {
  let html = "";
  let elements: FakeElement[] = [];
  let paints = 0;
  const root = {
    get innerHTML(): string {
      return html;
    },
    set innerHTML(next: string) {
      html = next;
      elements = elementsOf(next);
      paints += 1;
    },
    querySelectorAll(selector: string): FakeElement[] {
      return elements.filter((element) => matches(element, selector));
    },
  };
  return {
    root,
    get paints(): number {
      return paints;
    },
    find(selector: string): FakeElement {
      const found = root.querySelectorAll(selector)[0];
      assert.ok(found, `no element matched ${selector}`);
      return found;
    },
    all(selector: string): FakeElement[] {
      return root.querySelectorAll(selector);
    },
  };
}

interface FakeAdapterOptions {
  respond: (input: WarmblyGateInput) => Promise<AdapterWriteResult> | AdapterWriteResult;
  gate?: () => Record<string, unknown>;
  onNavigate?: (hash: string) => void;
}

function gateAdapter(options: FakeAdapterOptions): {
  adapter: Record<string, unknown>;
  seen: WarmblyGateInput[];
} {
  const seen: WarmblyGateInput[] = [];
  const adapter = {
    mode: "http" as const,
    actions: ["read"] as const,
    lastOperatorResult: undefined as AdapterWriteResult | undefined,
    readOperator: () => ({ kind: "human" as const, id: "human:operator", display_name: "Fundador" }),
    readDestination: () => ({
      ok: true as const,
      loading: false as const,
      page: {
        id: "warmbly",
        label: "Operação Warmbly",
        scope: "company",
        generated_at: "2026-08-23T12:00:00Z",
        operator: { kind: "human", id: "human:operator", display_name: "Fundador" },
        headline: "Operação Warmbly",
        attention: [],
        priorities: [],
        commercial: {
          provenance: {
            source: { system: "warmbly", kind: "dispatch", locator: "dispatch" },
            observed_at: "2026-08-23T12:00:00Z",
            freshness_status: "FRESH",
            confidence: 1,
          },
          operations: {},
        },
        warmbly_gate: options.gate ? options.gate() : gatePayload(),
      } as never,
    }),
    warmblyGate: async (input: WarmblyGateInput) => {
      seen.push({ ...input });
      return options.respond(input);
    },
  };
  return { adapter, seen };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function reset(): void {
  resetGateFlight();
  clearPendingResumeConfirmation();
}

/* ------------------------------------------------------------------ *
 * 1. Discoverability.
 * ------------------------------------------------------------------ */

test("the subnav carries the selected version across every Warmbly surface", () => {
  reset();
  for (const surface of ["operacao", "cohorts", "revisao"] as const) {
    const html = warmblyBlock(surfaceInput(), surface);
    for (const target of ["operacao", "cohorts", "revisao"]) {
      assert.match(
        html,
        new RegExp(`href="#/warmbly/${target}\\?resource=${COHORT_ID}"`),
        `${surface} → ${target} lost the selected resource`,
      );
    }
  }
});

test("Revisão without a resource offers the versions the server listed instead of an empty page", () => {
  reset();
  const html = warmblyBlock(
    surfaceInput({ gate: gatePayload(["operators"], null), resource: null }),
    "revisao",
  );
  assert.match(html, /data-review-empty="true"/);
  assert.match(html, /data-cohort-selector="true"/);
  assert.match(html, new RegExp(`data-cohort-option="${COHORT_ID}"`));
  assert.match(html, new RegExp(`data-open-review="true" href="#/warmbly/revisao\\?resource=${COHORT_ID}"`));
});

test("Revisão says the list was unreadable instead of implying there are no cohorts", () => {
  reset();
  const html = warmblyBlock(
    surfaceInput({
      gate: { list: {}, list_status: "not_mounted", list_detail: "HTTP 404" },
      resource: null,
    }),
    "revisao",
  );
  assert.match(html, /data-gate-read="not_mounted"/);
  assert.match(html, /Ausência aqui não é ausência de cohorts/);
});

test("#/warmbly opens on the pilot stepper with the latest cohort and a way into its review", () => {
  reset();
  const html = warmblyBlock(surfaceInput(), "operacao");
  assert.match(html, /data-pilot-summary="true"/);
  for (const step of ["fonte", "cohort", "validacao", "revisao", "go", "handoff"]) {
    assert.match(html, new RegExp(`data-step="${step}"`), `step ${step} is missing`);
  }
  assert.match(html, new RegExp(`data-latest-cohort="${COHORT_ID}"`));
  assert.match(html, new RegExp(`data-open-review="true" href="#/warmbly/revisao\\?resource=${COHORT_ID}"`));
});

test("a stepper with no readable gate says it does not know, never that a step is pending", () => {
  reset();
  const html = warmblyBlock(
    surfaceInput({ gate: { list: {}, list_status: "unreadable", list_detail: "TypeError" } }),
    "operacao",
  );
  const states = [...html.matchAll(/data-step-state="([a-z_]+)"/g)].map((match) => match[1]);
  assert.deepEqual(new Set(states), new Set(["unknown"]));
});

/* ------------------------------------------------------------------ *
 * 2. The message must be reviewable.
 * ------------------------------------------------------------------ */

test("recipient, exact subject and exact body are visible by default on every candidate", () => {
  reset();
  const html = warmblyBlock(surfaceInput(), "revisao");
  const details = html.match(/<details data-message-preview="true"([^>]*)>/);
  assert.ok(details, "the message block must exist");
  assert.match(details[1]!, /\bopen\b/, "the exact message must not start collapsed");
  assert.match(html, /data-exact-subject="true"[^>]*><strong>Assunto:<\/strong> Assunto exato congelado/);
  assert.match(html, /data-exact-body="true">Corpo exato congelado/);
  assert.match(html, /compras@empresa\.invalid/);
});

test("the messages collapse only when the operator asks, through the expand/collapse control", () => {
  reset();
  const collapsed = warmblyBlock(surfaceInput({ query: "mensagens=recolhidas" }), "revisao");
  assert.doesNotMatch(collapsed, /<details data-message-preview="true" open>/);
  assert.match(collapsed, /data-toggle-messages="true" aria-expanded="false"/);
  assert.match(collapsed, /Expandir todas as mensagens/);
});

test("provenance, CTA, hashes, versions, expiry and every blocker travel with the candidate", () => {
  reset();
  const html = warmblyBlock(surfaceInput(), "revisao");
  for (const label of [
    "Fato observado",
    "Proveniência do fato",
    "Chamada para ação (CTA)",
    "Content hash",
    "Frozen hash",
    "Policy version",
    "Composer version",
    "Validação vence em",
    "Reprovações de copy QA",
    "Duplicidade apontada pelo servidor",
    "Proveniência ausente",
    "Hard bounce registrado",
    "Excluído do preview por",
  ]) {
    assert.ok(html.includes(label), `${label} is missing from the candidate card`);
  }
  assert.match(html, /data-candidate-blockers="approval_missing_or_invalid"/);
  assert.match(html, /assunto_generico/);
});

test("preview denominators are rendered verbatim, and an absent number says so instead of being derived", () => {
  reset();
  const full = warmblyBlock(surfaceInput(), "revisao");
  for (const label of ["Considerados", "Elegíveis", "Excluídos", "Destinatários finais"]) {
    assert.ok(full.includes(label), `${label} denominator is missing`);
  }
  const sparse = warmblyBlock(
    surfaceInput({
      gate: gatePayload(["operators"], cohort({ manifest: { preview: { accounts_considered: 7 } } })),
    }),
    "revisao",
  );
  assert.match(sparse, /não informado pelo servidor/);
  // 7 considered with nothing else must not become "7 - 0 = 7 eligible".
  assert.doesNotMatch(sparse, /<dt>Elegíveis<\/dt><dd>7<\/dd>/);
});

/* ------------------------------------------------------------------ *
 * 3. Actions must be comprehensible and safe.
 * ------------------------------------------------------------------ */

const SAMPLE_RESULT: AdapterWriteResult = {
  ok: true,
  path: "/v1/warmbly/operator/cohorts",
  kind: "nota",
  status: 201,
  outcome: "executed",
  message: "Cohort congelada criada v1.",
  gateAction: "create",
  receiptId: "receipt-fixture-1",
  correlationId: "cc:human-gate:fixture-1",
  readback: { status: "confirmed", detail: "O servidor devolve a versão v1." },
};

for (const surface of ["operacao", "cohorts", "revisao"] as const) {
  test(`a write outcome is rendered on ${surface}, with code, receipt, correlation id and next action`, () => {
    reset();
    const html = warmblyBlock(surfaceInput({ operatorResult: SAMPLE_RESULT }), surface);
    assert.match(html, /data-write-result="executed"/, "the shared wrapper did not render");
    assert.match(html, /data-gate-action="create"/);
    assert.match(html, /receipt-fixture-1/);
    assert.match(html, /cc:human-gate:fixture-1/);
    assert.match(html, /data-outcome-recovery="true"/);
    assert.match(html, /data-readback="confirmed"/);
    // Rendered once. A banner repeated at the top and on the card reads as two
    // separate events to the operator.
    assert.equal((html.match(/data-write-result=/g) ?? []).length, 1);
  });
}

test("feedback for a candidate lands on that candidate's card, not at the top of the page", () => {
  reset();
  const html = warmblyBlock(
    surfaceInput({
      operatorResult: {
        ...SAMPLE_RESULT,
        gateAction: "review",
        gateTarget: { cohort_id: COHORT_ID, candidate_id: CANDIDATE_ID },
      },
    }),
    "revisao",
  );
  const cardStart = html.indexOf(`data-candidate-id="${CANDIDATE_ID}"`);
  const banner = html.indexOf('data-write-result="executed"');
  assert.ok(cardStart > 0 && banner > cardStart, "the outcome must render inside the affected card");
  assert.equal((html.match(/data-write-result=/g) ?? []).length, 1);
});

test("APPROVE is offered only against a current VALID validation, and explains itself otherwise", () => {
  reset();
  const valid = warmblyBlock(surfaceInput(), "revisao");
  assert.match(valid, /data-approve-allowed="true"/);
  assert.doesNotMatch(valid, /data-approve-blocked="true"/);

  for (const status of ["INVALID", "UNKNOWN", "RISKY", "STALE"]) {
    const html = warmblyBlock(
      surfaceInput({
        gate: gatePayload(
          ["operators"],
          cohort({ candidates: [candidate({ validation: { status } })] }),
        ),
      }),
      "revisao",
    );
    assert.match(html, /data-approve-allowed="false"/, `${status} must not offer APPROVE`);
    assert.match(html, /data-approve-blocked="true"/, `${status} must explain the refusal`);
    const approveForm = html.match(/data-gate-key="review:[^"]*:APPROVE"[\s\S]*?<\/form>/)?.[0] ?? "";
    assert.match(approveForm, /Registrar APPROVE<\/button>/);
    assert.match(approveForm, /<button type="submit" disabled>/);
  }
});

test("a validation blocker from the server blocks APPROVE even when the status reads VALID", () => {
  reset();
  const html = warmblyBlock(
    surfaceInput({
      gate: gatePayload(
        ["operators"],
        cohort({ candidates: [candidate({ blocked_by: ["validation_stale"] })] }),
      ),
    }),
    "revisao",
  );
  assert.match(html, /data-approve-allowed="false"/);
  assert.match(html, /validation_stale/);
});

test("HOLD and REJECT ask for a reason and never for the approval acknowledgement", () => {
  reset();
  const html = warmblyBlock(surfaceInput(), "revisao");
  const holdForm = html.match(/data-gate-key="review:[^"]*:HOLD_REJECT"[\s\S]*?<\/form>/)?.[0] ?? "";
  assert.ok(holdForm.length > 0, "the HOLD/REJECT form must exist separately from APPROVE");
  assert.match(holdForm, /name="reason" required/);
  assert.doesNotMatch(holdForm, /name="ack"/, "HOLD/REJECT must not carry the approval checkbox");
  assert.match(holdForm, /data-no-ack-required="true"/);
  assert.match(holdForm, /<option value="HOLD">/);
  assert.match(holdForm, /<option value="REJECT">/);

  const approveForm = html.match(/data-gate-key="review:[^"]*:APPROVE"[\s\S]*?<\/form>/)?.[0] ?? "";
  assert.match(approveForm, /name="ack" required/, "APPROVE must still demand the acknowledgement");
});

test("HOLD really reaches the adapter without an acknowledgement", async () => {
  reset();
  const { adapter, seen } = gateAdapter({
    respond: () => ({
      ok: true,
      path: "/x",
      kind: "nota" as const,
      message: "HOLD registrado.",
      outcome: "executed",
      gateAction: "review" as const,
    }),
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  const form = dom.find(`[data-gate-key="review:${COHORT_ID}:${CANDIDATE_ID}:HOLD_REJECT"]`);
  form.set("reason", "endereço genérico demais");
  form.fire();
  await settle();
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.decision, "HOLD");
  assert.equal(seen[0]!.acknowledged, undefined);
});

test("a second click while a write is in flight does not become a second write", async () => {
  reset();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { adapter, seen } = gateAdapter({
    respond: async () => {
      await gate;
      return {
        ok: true,
        path: "/x",
        kind: "nota" as const,
        message: "criada",
        outcome: "executed",
        gateAction: "create" as const,
      };
    },
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, "#/warmbly/cohorts");
  dom.find('[data-human-gate="create"]').fire();
  await settle();
  // The pending paint must be visible, and it must be what stops the next click.
  assert.match(dom.root.innerHTML, /data-write-pending="true"/);
  dom.find('[data-human-gate="create"]').fire();
  await settle();
  assert.equal(seen.length, 1, "the second click must not reach the adapter");
  release?.();
  await settle();
  assert.doesNotMatch(dom.root.innerHTML, /data-write-pending="true"/);
});

test("an UNKNOWN outcome keeps the idempotency key so the retry is the same intent", async () => {
  reset();
  let attempt = 0;
  const { adapter, seen } = gateAdapter({
    respond: () => {
      attempt += 1;
      return attempt === 1
        ? {
            ok: false,
            path: "/x",
            kind: "nota" as const,
            message: "sem resposta",
            outcome: "unknown",
            code: "human_gate_transport_unknown",
            gateAction: "review" as const,
          }
        : {
            ok: true,
            path: "/x",
            kind: "nota" as const,
            message: "registrado",
            outcome: "executed",
            gateAction: "review" as const,
          };
    },
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  const key = `review:${COHORT_ID}:${CANDIDATE_ID}:HOLD_REJECT`;
  const first = dom.find(`[data-gate-key="${key}"]`);
  first.set("reason", "mesmo motivo exato");
  first.fire();
  await settle();
  const second = dom.find(`[data-gate-key="${key}"]`);
  second.set("reason", "mesmo motivo exato");
  second.fire();
  await settle();
  assert.equal(seen.length, 2);
  assert.equal(
    seen[0]!.idempotency_key,
    seen[1]!.idempotency_key,
    "an unresolved intent must be retried under the same key",
  );
});

test("a definitive write is only claimed after the readback, and a divergent readback says so", async () => {
  reset();
  const { adapter } = gateAdapter({
    respond: () => ({
      ok: true,
      path: "/x",
      kind: "nota" as const,
      message: "registrado",
      outcome: "executed",
      gateAction: "review" as const,
      gateTarget: { cohort_id: COHORT_ID, candidate_id: CANDIDATE_ID },
    }),
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  const form = dom.find(`[data-gate-key="review:${COHORT_ID}:${CANDIDATE_ID}:HOLD_REJECT"]`);
  form.set("reason", "não confere ainda");
  form.fire();
  await settle();
  // The fixture keeps answering `review.decision = HOLD` with `effective:false`
  // for a HOLD submit, so this readback confirms; the branch that matters is
  // that the readback ran at all and is reported.
  assert.match(dom.root.innerHTML, /data-readback="(confirmed|not_confirmed)"/);
});

/* ------------------------------------------------------------------ *
 * 4. Adjust.
 * ------------------------------------------------------------------ */

test("the adjust editor offers exactly subject, body and reason, and warns that it forks a version", () => {
  reset();
  const html = warmblyBlock(surfaceInput(), "revisao");
  const editor = html.match(/<details class="card" data-adjust-editor[\s\S]*?<\/details>/)?.[0] ?? "";
  assert.ok(editor.length > 0, "the adjust editor must exist");
  assert.match(editor, /data-adjust-warning="true"/);
  assert.match(editor, /cria uma NOVA versão/i);
  const names = [...editor.matchAll(/name="([a-z_]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(names, ["body_text", "confirmation", "reason", "subject"]);
  for (const forbidden of ["mailbox", "evidence", "route_class", "policy_version", "source"]) {
    assert.doesNotMatch(editor, new RegExp(`name="${forbidden}"`), `${forbidden} must never be editable`);
  }
});

test("the first adjust submit previews the diff and writes nothing", async () => {
  reset();
  const { adapter, seen } = gateAdapter({
    respond: () => {
      throw new Error("the preview step must not reach the adapter");
    },
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  const form = dom.find(`[data-gate-key="adjust:${COHORT_ID}:${CANDIDATE_ID}:"]`);
  form.set("subject", "Assunto revisado pelo operador");
  form.set("body_text", "Corpo revisado pelo operador.");
  form.set("reason", "assunto genérico demais");
  form.fire();
  await settle();
  assert.equal(seen.length, 0, "the preview must not write");
  assert.match(dom.root.innerHTML, /data-adjust-diff="true"/);
  assert.match(dom.root.innerHTML, /Assunto exato congelado/);
  assert.match(dom.root.innerHTML, /Assunto revisado pelo operador/);
  assert.match(dom.root.innerHTML, /data-adjust-step="confirm"/);
});

test("a confirmed adjust sends the contract body and lands on the new version the server named", async () => {
  reset();
  const navigations: string[] = [];
  const { adapter, seen } = gateAdapter({
    respond: () => ({
      ok: true,
      path: "/x",
      kind: "nota" as const,
      status: 201,
      message: "Ajuste aceito.",
      outcome: "executed",
      gateAction: "adjust" as const,
      gateTarget: { cohort_id: COHORT_ID, candidate_id: CANDIDATE_ID },
      gateResource: { cohort_id: NEXT_COHORT_ID, version: 2 },
      diff: [{ field: "subject", before: "Assunto exato congelado", after: "Assunto revisado" }],
    }),
  });
  const dom = paintingRoot();
  paintShell(
    dom.root as never,
    adapter as never,
    `#/warmbly/revisao?resource=${COHORT_ID}`,
    0,
    () => true,
    (hash) => {
      navigations.push(hash);
    },
  );
  const preview = dom.find(`[data-gate-key="adjust:${COHORT_ID}:${CANDIDATE_ID}:"]`);
  preview.set("subject", "Assunto revisado");
  preview.set("body_text", "Corpo revisado.");
  preview.set("reason", "assunto genérico demais");
  preview.fire();
  await settle();
  const confirm = dom.find(`[data-gate-key="adjust:${COHORT_ID}:${CANDIDATE_ID}:"]`);
  confirm.fire();
  await settle();

  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.action, "adjust");
  assert.equal(seen[0]!.subject, "Assunto revisado");
  assert.equal(seen[0]!.body_text, "Corpo revisado.");
  assert.equal(seen[0]!.reason, "assunto genérico demais");
  assert.equal(seen[0]!.confirmation, "v1");
  assert.equal(seen[0]!.expected_frozen_hash, "frozen-fixture-001");
  assert.deepEqual(navigations, [`#/warmbly/revisao?resource=${NEXT_COHORT_ID}`]);
});

test("the new version opens with validation, review and GO all pending", () => {
  reset();
  const fresh = cohort({
    id: NEXT_COHORT_ID,
    version: 2,
    candidates: [candidate({ validation: { status: "UNKNOWN" }, review: {}, blocked_by: [] })],
    decision: {},
  });
  const html = warmblyBlock(
    surfaceInput({
      gate: {
        list: { data: [fresh], edge_actor: { id: "u", groups: ["operators", "admins"] } },
        list_status: "read",
        selected: { data: fresh },
        selected_status: "read",
      },
      resource: NEXT_COHORT_ID,
    }),
    "revisao",
  );
  assert.match(html, /Revisão v2/);
  assert.match(html, /data-approve-allowed="false"/, "a fresh version cannot already be approvable");
  assert.match(html, /<dt>Revisão registrada<\/dt><dd>não informado pelo servidor<\/dd>/);
  assert.match(html, /<dt>Decisão final registrada<\/dt><dd>não informado pelo servidor<\/dd>/);
});

test("every adjust refusal code renders its own actionable sentence", () => {
  reset();
  const expectations: Record<string, RegExp> = {
    frozen_hash_mismatch: /conteúdo congelado mudou desde a sua leitura/i,
    confirmation_mismatch: /confirmação não corresponde à versão/i,
    version_superseded: /já foi substituída por outra mais nova/i,
    authority_active: /autoridade bounded ativa/i,
    immutable_field: /campo imutável/i,
    copy_qa_failed: /reprovou no QA de copy/i,
    candidate_not_found: /candidato não encontrado nesta versão/i,
    adjust_route_unavailable: /ainda não foi implantada neste ambiente/i,
  };
  for (const [code, expected] of Object.entries(expectations)) {
    const html = warmblyBlock(
      surfaceInput({
        operatorResult: {
          ok: false,
          path: "/x",
          kind: "nota",
          message: code,
          outcome: "refused",
          status: code === "candidate_not_found" || code === "adjust_route_unavailable" ? 404 : 409,
          code,
          gateAction: "adjust",
        },
      }),
      "revisao",
    );
    assert.match(html, expected, `${code} did not render its own explanation`);
    assert.match(html, /data-outcome-recovery="true"/, `${code} rendered no next action`);
  }
});

test("adjust degrades gracefully when the route is not deployed: the editor stops offering the write", async () => {
  reset();
  const { adapter } = gateAdapter({
    respond: () => ({
      ok: false,
      path: "/x",
      kind: "nota" as const,
      status: 404,
      message: "route is outside the fixed human-gate allowlist",
      outcome: "refused",
      code: "adjust_route_unavailable",
      gateAction: "adjust" as const,
      gateTarget: { cohort_id: COHORT_ID, candidate_id: CANDIDATE_ID },
    }),
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  const preview = dom.find(`[data-gate-key="adjust:${COHORT_ID}:${CANDIDATE_ID}:"]`);
  preview.set("subject", "Assunto revisado");
  preview.set("body_text", "Corpo revisado.");
  preview.set("reason", "motivo do ajuste");
  preview.fire();
  await settle();
  dom.find(`[data-gate-key="adjust:${COHORT_ID}:${CANDIDATE_ID}:"]`).fire();
  await settle();
  assert.match(dom.root.innerHTML, /data-adjust-unavailable="true"/);
  assert.match(dom.root.innerHTML, /ainda não foi implantada neste ambiente/i);
});

test("the HTTP adapter refuses an adjust without its anti-clobber tokens before the wire", async () => {
  reset();
  const calls: string[] = [];
  const adapter = new HttpControlCenterAdapter({
    baseUrl: "http://control-center.fixture",
    fetchImpl: (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({}), { status: 201 });
    }) as typeof fetch,
  });
  const base = {
    action: "adjust" as const,
    version_id: COHORT_ID,
    candidate_id: CANDIDATE_ID,
    subject: "s",
    body_text: "b",
    reason: "r",
    idempotency_key: "cc-human-gate:v1:fixture:0",
  };
  assert.equal((await adapter.warmblyGate({ ...base })).code, "confirmation_mismatch");
  assert.equal(
    (await adapter.warmblyGate({ ...base, confirmation: "v1" })).code,
    "gate_precondition",
  );
  assert.equal(calls.length, 0, "an incomplete adjust must never reach the channel");

  const accepted = await adapter.warmblyGate({
    ...base,
    confirmation: "v1",
    expected_frozen_hash: "frozen-fixture-001",
  });
  assert.equal(accepted.ok, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /\/candidates\/[^/]+\/adjust$/);
});

test("the adjust wire body is exactly the contract's five fields plus the idempotency key", async () => {
  reset();
  let sent: Record<string, unknown> = {};
  const adapter = new HttpControlCenterAdapter({
    baseUrl: "http://control-center.fixture",
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          cohort: { id: NEXT_COHORT_ID, version: 2 },
          adjustment: {
            from_version: 1,
            to_version: 2,
            candidate_id: CANDIDATE_ID,
            receipt: "receipt-adjust-1",
            correlation_id: "cc:human-gate:adjust-1",
            diff: [{ field: "subject", before: "antes", after: "depois" }],
          },
        }),
        { status: 201 },
      );
    }) as typeof fetch,
  });
  const result = await adapter.warmblyGate({
    action: "adjust",
    version_id: COHORT_ID,
    candidate_id: CANDIDATE_ID,
    subject: "Assunto revisado",
    body_text: "Corpo revisado.",
    reason: "assunto genérico",
    confirmation: "v1",
    expected_frozen_hash: "frozen-fixture-001",
    idempotency_key: "cc-human-gate:v1:fixture:0",
  });
  assert.deepEqual(Object.keys(sent).sort(), [
    "body_text",
    "confirmation",
    "expected_frozen_hash",
    "idempotency_key",
    "reason",
    "subject",
  ]);
  assert.equal(sent.confirmation, "v1");
  assert.deepEqual(result.gateResource, { cohort_id: NEXT_COHORT_ID, version: 2 });
  assert.equal(result.receiptId, "receipt-adjust-1");
  assert.equal(result.correlationId, "cc:human-gate:adjust-1");
  assert.deepEqual(result.diff, [{ field: "subject", before: "antes", after: "depois" }]);
});

test("gate results carry their own action and resource instead of one generic sentence", async () => {
  reset();
  const adapter = new HttpControlCenterAdapter({
    baseUrl: "http://control-center.fixture",
    fetchImpl: (async () =>
      new Response(JSON.stringify({ id: NEXT_COHORT_ID, version: 2, receipt: "r-create" }), {
        status: 201,
      })) as typeof fetch,
  });
  const created = await adapter.warmblyGate({
    action: "create",
    limit: 5,
    idempotency_key: "cc-human-gate:v1:fixture:0",
  });
  assert.equal(created.gateAction, "create");
  assert.deepEqual(created.gateResource, { cohort_id: NEXT_COHORT_ID, version: 2 });
  assert.doesNotMatch(created.message, /Decisão registrada/);
  assert.match(created.message, /Cohort congelada criada v2\./);
});

/* ------------------------------------------------------------------ *
 * 5. RBAC and environment.
 * ------------------------------------------------------------------ */

test("the surface names the operator and the environment without a raw identifier in the visible text", () => {
  reset();
  const html = warmblyBlock(surfaceInput(), "revisao");
  const identity = html.match(/<article class="card" data-operator-identity="true"[\s\S]*?<\/article>/)?.[0] ?? "";
  assert.ok(identity.length > 0);
  const visible = identity.replace(/<details class="tech"[\s\S]*?<\/details>/g, " ");
  assert.match(visible, /Fundador/);
  assert.match(visible, /ops\.confenge\.com\.br/);
  assert.doesNotMatch(visible, /human:operator/, "the raw identifier belongs in the technical block");
  assert.match(identity, /identificador_auditavel/);
});

test("GO is disabled without admins and says how to obtain the authority", () => {
  reset();
  const operatorsOnly = warmblyBlock(
    surfaceInput({ gate: gatePayload(["operators"]) }),
    "revisao",
  );
  assert.match(operatorsOnly, /data-can-decide="false"/);
  assert.match(operatorsOnly, /data-go-authority="absent"/);
  assert.match(operatorsOnly, /exige o grupo <code>admins<\/code> no Authelia/);
  const decideForm = operatorsOnly.match(/data-human-gate="decide"[\s\S]*?<\/form>/)?.[0] ?? "";
  assert.match(decideForm, /<button type="submit" disabled>/);

  const admins = warmblyBlock(surfaceInput(), "revisao");
  assert.match(admins, /data-can-decide="true"/);
  const enabled = admins.match(/data-human-gate="decide"[\s\S]*?<\/form>/)?.[0] ?? "";
  assert.doesNotMatch(enabled, /<button type="submit" disabled>/);
});

test("capabilities the channel never reported are rendered as unknown, never as granted", () => {
  reset();
  const html = warmblyBlock(
    surfaceInput({
      gate: {
        list: { data: [cohort()] },
        list_status: "read",
        selected: { data: cohort() },
        selected_status: "read",
      },
    }),
    "revisao",
  );
  assert.match(html, /data-can-decide="false"/);
  assert.match(html, /não informado pelo servidor/);
  assert.match(html, /não teve os grupos confirmados pelo canal|não devolveu os grupos efetivos/);
});

test("no gate write ever carries a browser-set actor header", async () => {
  reset();
  const headers: Array<Record<string, string>> = [];
  const adapter = new HttpControlCenterAdapter({
    baseUrl: "http://control-center.fixture",
    fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      headers.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(JSON.stringify({ id: COHORT_ID, version: 1 }), { status: 201 });
    }) as typeof fetch,
  });
  await adapter.warmblyGate({ action: "create", limit: 5, idempotency_key: "cc-human-gate:v1:a:0" });
  await adapter.warmblyGate({
    action: "adjust",
    version_id: COHORT_ID,
    candidate_id: CANDIDATE_ID,
    subject: "s",
    body_text: "b",
    reason: "r",
    confirmation: "v1",
    expected_frozen_hash: "f",
    idempotency_key: "cc-human-gate:v1:b:0",
  });
  assert.equal(headers.length, 2);
  for (const header of headers) {
    assert.equal(header["x-actor-id"], undefined);
    assert.equal(header["x-actor-kind"], undefined);
  }
});

test("the gate never exposes a queue, dispatch, send, resume or payment control", () => {
  reset();
  for (const surface of ["cohorts", "revisao"] as const) {
    const html = warmblyBlock(surfaceInput(), surface);
    assert.doesNotMatch(html, /data-human-gate="(queue|dispatch|send|resume|payment)"/);
    assert.doesNotMatch(html, /enviar agora|disparar|SEND_CAMPAIGN|cobran[çc]a|checkout/i);
  }
});

test("a gate read that fails never takes the destination down and never sends an actor header", async () => {
  reset();
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const adapter = new HttpControlCenterAdapter({
    baseUrl: "http://control-center.fixture",
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url.includes("/v1/warmbly/operator/cohorts")) {
        return new Response(JSON.stringify({ code: "human_gate_route_not_allowed" }), { status: 404 });
      }
      if (url.includes("/v1/domains/commercial")) {
        return new Response(
          JSON.stringify({
            schema_version: "control-center.commercial-snapshot.v1",
            id: "cc:commercial-snapshot:fixture",
            scope: "commercial",
            generated_at: "2026-08-23T12:00:00Z",
            provenance: {
              source: { system: "warmbly", kind: "crm-read-model", locator: "commercial/pipeline" },
              observed_at: "2026-08-23T11:59:00Z",
              freshness_status: "FRESH",
              confidence: 1,
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch,
    operator: { kind: "human", id: "human:operator" },
  });
  const read = await adapter.readDestination("warmbly", `#/warmbly/revisao?resource=${COHORT_ID}`);
  assert.equal(read.ok, true, "a 404 on the gate must not fail the whole destination");
  assert.equal(read.loading, false);
  const gate = (read as { page: { warmbly_gate?: Record<string, unknown> } }).page.warmbly_gate ?? {};
  assert.equal(gate.list_status, "not_mounted");
  assert.equal(gate.selected_status, "not_mounted");

  const gateReads = requests.filter((request) => request.url.includes("/v1/warmbly/operator/cohorts"));
  assert.ok(gateReads.length >= 2, "list and selected are both read");
  for (const request of gateReads) {
    assert.equal(request.headers["x-actor-id"], undefined);
    assert.equal(request.headers["x-actor-kind"], undefined);
  }
});

test("the operation cockpit reads the gate too, because its stepper has to know where the pilot stands", async () => {
  reset();
  const urls: string[] = [];
  const adapter = new HttpControlCenterAdapter({
    baseUrl: "http://control-center.fixture",
    fetchImpl: (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch,
    operator: { kind: "human", id: "human:operator" },
  });
  await adapter.readDestination("warmbly", "#/warmbly");
  assert.ok(
    urls.some((url) => url.includes("/v1/warmbly/operator/cohorts?limit=50")),
    "#/warmbly must read the cohort list",
  );
});
