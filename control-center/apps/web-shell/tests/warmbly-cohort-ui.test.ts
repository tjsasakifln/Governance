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
import {
  approvalShortcutScope,
  isEditingTarget,
  paintShell,
  resetQueueAdvance,
} from "../src/app";
import { resetGateFlight } from "../src/human-gate-flight";
import { REVIEW_QUEUE_PARAM, resetReviewQueue } from "../src/review-queue";
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
    // As chaves que a API de produção manda mesmo: texto simples, não objeto,
    // e nenhum frozen_hash no candidato.
    observed_fact: "Fato público de fixture",
    fact_source: "fixture://diario-oficial",
    evidence_observed_at: "2026-08-22T12:00:00Z",
    content_hash: "content-fixture-001",
    evidence_hash: "evidence-fixture-001",
    composer_version: "composer.v3",
    copy_qa: { failures: ["assunto_generico"] },
    duplicate_of: "outro-candidato-fixture",
    missing_provenance: false,
    hard_bounce: false,
    exclusion_reason: "nenhuma",
    validation: { status: "VALID", reason: "MX confirmado no sandbox", expires_at: "2026-08-24T12:00:00Z" },
    // Undecided, which is what a candidate looks like when the reviewer opens
    // the queue. `pendentes` is the default recorte and this is what belongs in
    // it; the tests that need a decided candidate say so explicitly.
    review: null,
    blocked_by: ["approval_missing_or_invalid"],
    ...overrides,
  };
}

/** The recorte that shows everything, for the tests that are not about filtering. */
const ALL_STATES = `${REVIEW_QUEUE_PARAM}=todas`;

function cohort(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: COHORT_ID,
    version: 1,
    // frozen_hash belongs to the version, which is what expected_frozen_hash
    // guards. A candidate has content_hash and evidence_hash and no frozen
    // hash of its own.
    frozen_hash: "frozen-fixture-001",
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
  /** Whether the queue advance put the reviewer on this control. */
  focused = false;
  centred = false;
  private listeners: Array<{ type: string; listener: (event: Event) => void }> = [];

  constructor(attributes: Record<string, string>, fields: Record<string, FakeField>) {
    this.attributes = attributes;
    this.fields = fields;
  }

  focus(): void {
    this.focused = true;
  }

  scrollIntoView(options?: { block?: "center" }): void {
    this.centred = options?.block === "center";
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
    // The approve button is collected in its own right because the queue
    // advance addresses it directly: it is what the reviewer's focus lands on
    // between two approvals.
    if (
      attributes["data-toggle-messages"] !== undefined
      || attributes["data-approve-submit"] !== undefined
    ) {
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
  resetReviewQueue();
  resetQueueAdvance();
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

test("o fato observado e a proveniência saem das chaves que a produção manda mesmo", () => {
  reset();
  // observed_fact e fact_source chegam como texto simples. Lidos como objeto,
  // o fato real virava "não informado pelo servidor" embaixo de uma mensagem
  // que afirmava exatamente esse fato.
  const html = warmblyBlock(surfaceInput(), "revisao");
  assert.match(html, /<dt>Fato observado<\/dt><dd>Fato público de fixture<\/dd>/);
  assert.match(html, /<dt>Proveniência do fato<\/dt><dd>fixture:\/\/diario-oficial<\/dd>/);
  assert.doesNotMatch(html, /<dt>Fato observado<\/dt><dd>não informado pelo servidor<\/dd>/);
  assert.doesNotMatch(html, /<dt>Proveniência do fato<\/dt><dd>não informado pelo servidor<\/dd>/);
});

test("o formato antigo de evidence em objeto continua sendo lido", () => {
  reset();
  const legacyShape = cohort({
    candidates: [
      candidate({
        observed_fact: undefined,
        fact_source: undefined,
        evidence: { text: "Fato vindo do formato objeto", source: "objeto://origem" },
      }),
    ],
  });
  const html = warmblyBlock(
    surfaceInput({ gate: gatePayload(["operators", "admins"], legacyShape) }),
    "revisao",
  );
  assert.match(html, /<dt>Fato observado<\/dt><dd>Fato vindo do formato objeto<\/dd>/);
  assert.match(html, /<dt>Proveniência do fato<\/dt><dd>objeto:\/\/origem<\/dd>/);
});

test("o bloco de decisão carrega só o que muda a decisão do fundador", () => {
  reset();
  const html = warmblyBlock(surfaceInput(), "revisao");
  const decision = html.match(/<dl class="facts" data-candidate-identity="true"[\s\S]*?<\/dl>/);
  assert.ok(decision, "o bloco de decisão precisa existir");
  const visible = decision[0]!;
  for (const label of [
    "Destinatário exato",
    "Classe de rota",
    "Fato observado",
    "Proveniência do fato",
    "Estado editorial",
  ]) {
    assert.ok(visible.includes(label), `${label} sumiu do bloco de decisão`);
  }
  // Bloqueio e reprovação de copy QA aparecem porque travam a aprovação.
  assert.match(html, /data-candidate-blockers="approval_missing_or_invalid"/);
  assert.match(visible, /<dt>Reprovações de copy QA<\/dt><dd>assunto_generico<\/dd>/);
  // Auditoria não é decisão: hash, versão e recibo não ocupam o bloco visível.
  for (const label of [
    "Content hash",
    "Frozen hash",
    "Evidence hash",
    "Policy version",
    "Composer version",
    "Observado em",
    "Motivo da validação",
    "Validação vence em",
    "Revisão registrada",
    "Revisão efetiva",
  ]) {
    assert.ok(!visible.includes(label), `${label} não devia estar no bloco de decisão`);
  }
});

test("hash, versão e recibo moram no detalhe técnico recolhido, não na tabela visível", () => {
  reset();
  // Um candidato já segurado, no recorte que mostra tudo: é onde a decisão
  // registrada e a efetividade dela precisam continuar auditáveis.
  const held = cohort({
    candidates: [candidate({ review: { decision: "HOLD", effective: false } })],
  });
  const html = warmblyBlock(
    surfaceInput({ query: ALL_STATES, gate: gatePayload(["operators", "admins"], held) }),
    "revisao",
  );
  const tech = html.match(/<details class="tech" data-tech="warmbly-candidate">[\s\S]*?<\/details>/);
  assert.ok(tech, "o detalhe técnico do candidato precisa existir");
  const audit = tech[0]!;
  assert.match(audit, /<dt>content_hash<\/dt><dd><code>content-fixture-001<\/code><\/dd>/);
  assert.match(audit, /<dt>evidence_hash<\/dt><dd><code>evidence-fixture-001<\/code><\/dd>/);
  assert.match(audit, /<dt>policy_version<\/dt><dd><code>bounded-cohort-policy\.v1<\/code><\/dd>/);
  assert.match(audit, /<dt>composer_version<\/dt><dd><code>composer\.v3<\/code><\/dd>/);
  assert.match(audit, /<dt>validation_status<\/dt><dd><code>VALID<\/code><\/dd>/);
  assert.match(audit, /<dt>review_decision<\/dt><dd><code>HOLD<\/code><\/dd>/);
  assert.match(audit, /<dt>review_effective<\/dt><dd><code>false<\/code><\/dd>/);
});

test("o frozen hash exibido é o da versão, porque o candidato não tem um", () => {
  reset();
  // Mesma lição do PR #96 para expected_frozen_hash: frozen_hash pertence à
  // versão. Lido do candidato, saía vazio na tela e não batia com o servidor.
  const html = warmblyBlock(surfaceInput(), "revisao");
  const tech = html.match(/<details class="tech" data-tech="warmbly-candidate">[\s\S]*?<\/details>/);
  assert.ok(tech);
  assert.match(tech[0]!, /<dt>frozen_hash<\/dt><dd><code>frozen-fixture-001<\/code><\/dd>/);
});

test("campo ausente que não muda a decisão não vira linha nenhuma", () => {
  reset();
  // O candidato de produção não manda observed_at, duplicidade, hard bounce,
  // motivo de exclusão nem recibo de revisão. Onze linhas de "não informado
  // pelo servidor" empilhadas sob quatro linhas de e-mail escondiam o e-mail.
  const sparse = cohort({
    frozen_hash: undefined,
    candidates: [
      candidate({
        copy_qa: undefined,
        duplicate_of: undefined,
        missing_provenance: undefined,
        hard_bounce: undefined,
        exclusion_reason: undefined,
        evidence_observed_at: undefined,
        review: undefined,
        blocked_by: [],
      }),
    ],
  });
  const html = warmblyBlock(
    surfaceInput({ gate: gatePayload(["operators", "admins"], sparse) }),
    "revisao",
  );
  const card = html.match(/<article class="card" data-candidate-id=[\s\S]*?<\/article>/);
  assert.ok(card);
  for (const label of [
    "Observado em",
    "Duplicidade apontada pelo servidor",
    "Proveniência ausente",
    "Hard bounce registrado",
    "Excluído do preview por",
    "Revisão registrada",
    "Revisão efetiva",
    "Reprovações de copy QA",
    "Bloqueios",
  ]) {
    assert.ok(!card[0]!.includes(label), `${label} devia ter sumido, não virado "não informado"`);
  }
  const decision = card[0]!.match(/<dl class="facts" data-candidate-identity="true"[\s\S]*?<\/dl>/);
  assert.ok(decision);
  assert.doesNotMatch(decision[0]!, /não informado pelo servidor/);
});

test("o tipo de caixa é lido em português, e UNKNOWN não ocupa linha nenhuma", () => {
  reset();
  const html = warmblyBlock(surfaceInput(), "revisao");
  assert.match(html, /<dt>Tipo de caixa<\/dt><dd>caixa de cargo ou departamento \(ROLE_OR_DEPARTMENT\)<\/dd>/);
  const unknownPurpose = cohort({ candidates: [candidate({ mailbox_purpose: "UNKNOWN" })] });
  const unclassified = warmblyBlock(
    surfaceInput({ gate: gatePayload(["operators", "admins"], unknownPurpose) }),
    "revisao",
  );
  // O servidor dizendo "não classifiquei" não muda a decisão, e a classe de
  // rota logo acima já responde se a caixa é genérica ou de departamento.
  assert.ok(!unclassified.includes("Tipo de caixa"));
  // O valor cru não some do sistema: continua no detalhe técnico.
  assert.match(unclassified, /<dt>mailbox_purpose<\/dt><dd><code>UNKNOWN<\/code><\/dd>/);
});

test("sinalizador verdadeiro do servidor vira linha, e falso não", () => {
  reset();
  const flagged = cohort({
    candidates: [
      candidate({ missing_provenance: true, hard_bounce: false, duplicate_of: "outro-candidato" }),
    ],
  });
  const html = warmblyBlock(
    surfaceInput({ gate: gatePayload(["operators", "admins"], flagged) }),
    "revisao",
  );
  assert.match(html, /<dt>Proveniência ausente<\/dt><dd>sim<\/dd>/);
  assert.match(html, /<dt>Duplicidade apontada pelo servidor<\/dt><dd>outro-candidato<\/dd>/);
  assert.ok(!html.includes("Hard bounce registrado"));
});

test("fato faltando debaixo de uma mensagem que afirma uma observação é dito em voz alta", () => {
  reset();
  const noEvidence = cohort({
    candidates: [candidate({ observed_fact: undefined, fact_source: undefined })],
  });
  const html = warmblyBlock(
    surfaceInput({ gate: gatePayload(["operators", "admins"], noEvidence) }),
    "revisao",
  );
  assert.match(html, /data-fact-missing="true"/);
  assert.match(html, /nem o fato observado nem a proveniência dele/);
  assert.match(html, /<dt>Fato observado<\/dt><dd>não informado pelo servidor<\/dd>/);
  assert.match(html, /<div data-absent="true"[^>]*><dt>Fato observado<\/dt>/);
  assert.match(html, /<div data-absent="true"[^>]*><dt>Proveniência do fato<\/dt>/);
});

test("só a proveniência faltando também é dita, sem misturar com o fato", () => {
  reset();
  const noSource = cohort({ candidates: [candidate({ fact_source: undefined })] });
  const html = warmblyBlock(
    surfaceInput({ gate: gatePayload(["operators", "admins"], noSource) }),
    "revisao",
  );
  assert.match(html, /data-fact-missing="true"/);
  assert.match(html, /não enviou a proveniência do fato/);
  assert.match(html, /<dt>Fato observado<\/dt><dd>Fato público de fixture<\/dd>/);
});

test("com fato e proveniência no payload nenhum alerta de evidência é inventado", () => {
  reset();
  const html = warmblyBlock(surfaceInput(), "revisao");
  assert.doesNotMatch(html, /data-fact-missing="true"/);
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

test("a settled non-VALID verdict blocks APPROVE; an unresolved one is verified by the approval itself", () => {
  reset();
  const valid = warmblyBlock(surfaceInput(), "revisao");
  assert.match(valid, /data-approve-allowed="true"/);
  assert.doesNotMatch(valid, /data-approve-blocked="true"/);
  assert.match(valid, /data-approve-needs-validation="false"/);
  assert.doesNotMatch(valid, /data-human-gate="validate"/, "a VALID candidate needs no manual check");

  // The server resolved these two and re-checking will not move them.
  for (const status of ["INVALID", "RISKY"]) {
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
    assert.match(approveForm, /Aprovar<\/button>/);
    assert.match(approveForm, /<button type="submit" data-approve-submit="true" disabled>/);
  }

  // These the server never settled, so approving obtains the verification.
  for (const validation of [{ status: "UNKNOWN" }, { status: "STALE" }, undefined]) {
    const html = warmblyBlock(
      surfaceInput({
        gate: gatePayload(["operators"], cohort({ candidates: [candidate({ validation })] })),
      }),
      "revisao",
    );
    const label = validation?.status ?? "sem validação";
    assert.match(html, /data-approve-allowed="true"/, `${label} must still offer APPROVE`);
    assert.match(html, /data-approve-needs-validation="true"/, `${label} must verify first`);
    assert.match(html, /data-approve-autovalidate="true"/, `${label} must say it verifies first`);
    assert.doesNotMatch(html, /data-approve-blocked="true"/);
    // The manual control survives as an escape hatch, never as a prerequisite.
    assert.match(html, /data-human-gate="validate"/);
  }
});

test("um destinatário ausente ou que não é endereço trava a aprovação, e verificar de novo não é a saída", () => {
  reset();
  for (const [mailbox, needle] of [
    [undefined, /não enviou destinatário nenhum/],
    ["compras arroba empresa", /não é um endereço de e-mail/],
  ] as const) {
    const html = warmblyBlock(
      surfaceInput({
        gate: gatePayload(["operators"], cohort({ candidates: [candidate({ mailbox })] })),
      }),
      "revisao",
    );
    assert.match(html, /data-approve-allowed="false"/);
    assert.match(html, /data-approve-needs-validation="false"/);
    assert.match(html, needle);
  }
});

test("um bloqueio material do servidor trava a aprovação mesmo com validação VALID", () => {
  reset();
  for (const blocker of ["hard_bounce", "suppressed_recipient", "opt_out", "copy_qa_failed"]) {
    const html = warmblyBlock(
      surfaceInput({
        gate: gatePayload(
          ["operators"],
          cohort({ candidates: [candidate({ blocked_by: [blocker] })] }),
        ),
      }),
      "revisao",
    );
    assert.match(html, /data-approve-allowed="false"/, `${blocker} devia travar APPROVE`);
    assert.match(html, new RegExp(blocker));
    assert.match(html, /não se resolve verificando o destinatário de novo/);
  }
});

test("uma validação vencida deixa de ser um bloqueio e passa a ser trabalho da própria aprovação", () => {
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
  assert.match(html, /data-approve-allowed="true"/);
  assert.match(html, /data-approve-needs-validation="true"/);
  assert.match(html, /validation_stale/, "o bloqueio do servidor continua visível");
});

test("HOLD e REJECT exigem motivo escrito; aprovar não exige nem motivo nem caixa de ciência", () => {
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
  assert.doesNotMatch(approveForm, /name="ack"/, "a caixa de ciência saiu do fluxo normal");
  assert.doesNotMatch(approveForm, /name="reason" required/, "aprovação comum não exige texto");
  assert.match(approveForm, /name="reason" maxlength="200"/, "o comentário continua disponível");
  assert.match(approveForm, /data-approve-meaning="true"/, "o botão precisa dizer o que ele assume");
  assert.match(approveForm, /approved_by_human_reviewer/);
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
  // A nova versão nasce sem validação vigente, e isso deixou de ser um
  // bloqueio para o humano: aprovar obtém a verificação antes de registrar.
  assert.match(html, /data-approve-needs-validation="true"/, "a fresh version has no live validation");
  assert.match(html, /data-approve-autovalidate="true"/);
  assert.match(html, /data-queue-pending="1"/, "nada foi decidido nesta versão ainda");
  // Sem revisão registrada não há linha de revisão: ausência que não muda a
  // decisão não vira "não informado pelo servidor" na cara do fundador.
  assert.ok(!html.includes("Revisão registrada"));
  assert.match(html, /<dt>Validação<\/dt><dd>UNKNOWN<\/dd>/);
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


/* ------------------------------------------------------------------ *
 * 12. Legacy copy is history, not an offer.
 *
 * A founder opened a version composed by a superseded composer and found
 * defective copy presented exactly like current copy, with APPROVE, adjust and
 * GO beside it. Nothing on the screen said the text was historical. These
 * tests pin the fix: the version stays fully readable for audit, and every
 * decision affordance stops being emitted at all.
 * ------------------------------------------------------------------ */

const LEGACY_NOTICE =
  "Esta versão foi congelada por um redator que não é mais o vigente e por isso não pode ser enviada.";

function legacyCohort(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return cohort({
    editorial_state: "LEGACY_SUPERSEDED",
    actionable: false,
    editorial_reason_codes: ["composer_superseded"],
    editorial_notice: LEGACY_NOTICE,
    is_current_version: false,
    current_version: 3,
    current_version_id: NEXT_COHORT_ID,
    candidates: [
      candidate({
        editorial_state: "LEGACY_SUPERSEDED",
        actionable: false,
        editorial_reason_codes: ["composer_superseded"],
      }),
    ],
    ...overrides,
  });
}

function legacyInput(overrides: Record<string, unknown> = {}): Parameters<typeof warmblyBlock>[0] {
  return surfaceInput({ gate: gatePayload(["operators", "admins"], legacyCohort(overrides)) });
}

test("a historical version says so at the top, in plain Portuguese, with the reason", () => {
  reset();
  const html = warmblyBlock(legacyInput(), "revisao");
  assert.match(html, /data-legacy-banner="true"/);
  assert.match(html, /data-review-cohort="[^"]*" data-editorial-state="LEGACY_SUPERSEDED"/);
  assert.match(html, /data-actionable="false"/);
  assert.ok(html.includes("Versão histórica. Não enviar."), "the banner must name the state plainly");
  assert.ok(
    html.includes("composta por um redator anterior ao vigente"),
    "composer_superseded must be translated, not shown as a raw code",
  );
  assert.ok(html.includes(LEGACY_NOTICE), "the server's own notice must be rendered");
});

test("every editorial reason code has a Portuguese sentence, and an unknown one is shown verbatim", () => {
  reset();
  const html = warmblyBlock(
    legacyInput({
      editorial_reason_codes: ["composer_unstamped", "policy_superseded", "motivo_desconhecido"],
    }),
    "revisao",
  );
  assert.ok(html.includes("sem carimbo de redator"));
  assert.ok(html.includes("criada sob uma policy anterior"));
  assert.ok(html.includes("motivo_desconhecido"), "an unknown code must not be silently dropped");
});

test("the historical banner offers the current version as its primary way out", () => {
  reset();
  const html = warmblyBlock(legacyInput(), "revisao");
  const link = html.match(/<a class="button" data-open-current="true" href="([^"]+)">([^<]+)<\/a>/);
  assert.ok(link, "the escape hatch link must exist");
  assert.equal(link[1], `#/warmbly/revisao?resource=${NEXT_COHORT_ID}`);
  assert.equal(link[2], "Abrir versão corrente");
  assert.ok(html.includes("v3"), "the current version number travels with the link");
});

test("without a current_version_id the banner says so instead of inventing a link", () => {
  reset();
  const html = warmblyBlock(legacyInput({ current_version_id: undefined, current_version: undefined }), "revisao");
  assert.match(html, /data-legacy-banner="true"/);
  assert.doesNotMatch(html, /data-open-current="true"/);
  assert.match(html, /data-open-current="absent"/);
});

test("a historical version emits no approve, hold, validate, adjust, reproduce or GO markup at all", () => {
  reset();
  const html = warmblyBlock(legacyInput(), "revisao");
  for (const gate of ["validate", "review", "adjust", "reproduce", "decide"]) {
    assert.doesNotMatch(
      html,
      new RegExp(`data-human-gate="${gate}"`),
      `${gate} must not be rendered on a historical version, not even disabled`,
    );
  }
  assert.doesNotMatch(html, /data-adjust-editor=/);
  assert.doesNotMatch(html, /Registrar APPROVE|Registrar HOLD\/REJECT|Registrar GO\/NO-GO/);
  assert.match(html, /data-non-actionable-notice="true"/);
  assert.match(html, /data-non-actionable-surface="true"/);
});

test("a historical version stays fully readable: message, facts and hashes all render", () => {
  reset();
  const html = warmblyBlock(legacyInput(), "revisao");
  assert.match(html, /data-exact-body="true">Corpo exato congelado/);
  assert.match(html, /data-exact-subject="true"[^>]*><strong>Assunto:<\/strong> Assunto exato congelado/);
  assert.match(html, /compras@empresa\.invalid/);
  assert.ok(html.includes("Estado editorial"));
  assert.ok(html.includes("Versão histórica (não enviável)"));
  assert.match(html, /<dt>Fato observado<\/dt><dd>Fato público de fixture<\/dd>/);
  // A auditoria de uma versão histórica é justamente o que ela ainda serve.
  const tech = html.match(/<details class="tech" data-tech="warmbly-candidate">[\s\S]*?<\/details>/);
  assert.ok(tech, "o detalhe técnico precisa sobreviver na versão histórica");
  for (const term of ["content_hash", "frozen_hash", "policy_version", "composer_version", "editorial_state"]) {
    assert.ok(tech[0]!.includes(`<dt>${term}</dt>`), `${term} must survive on a historical version`);
  }
});

test("the frozen message never claims to be current when it is not", () => {
  reset();
  const historical = warmblyBlock(legacyInput(), "revisao");
  assert.ok(historical.includes("Mensagem exata congelada (assunto e corpo). Versão histórica, não enviar."));
  const current = warmblyBlock(surfaceInput(), "revisao");
  assert.ok(current.includes("Mensagem exata congelada (assunto e corpo). Versão corrente."));
  for (const html of [historical, current]) {
    assert.doesNotMatch(
      html,
      /Mensagem exata congelada \(assunto e corpo\)<\/summary>/,
      "the bare label that told the operator nothing must be gone",
    );
  }
});

test("a historical card is marked as such and carries a non-actionable chip", () => {
  reset();
  const html = warmblyBlock(legacyInput(), "revisao");
  assert.match(html, /<article class="card" data-candidate-id="[^"]*" data-editorial-state="LEGACY_SUPERSEDED"/);
  assert.match(html, /data-non-actionable="true"/);
  assert.match(html, /data-approve-allowed="false"/);
});

test("a current version keeps every control exactly as before", () => {
  reset();
  const html = warmblyBlock(surfaceInput(), "revisao");
  for (const gate of ["review", "adjust", "reproduce", "decide"]) {
    assert.match(html, new RegExp(`data-human-gate="${gate}"`), `${gate} must still be offered on a current version`);
  }
  // `validate` is the one control that moved: on a candidate the server already
  // reports VALID it is not a step, so it is offered only where it is the
  // actual next move. See the approval-gate tests above.
  const pending = warmblyBlock(
    surfaceInput({
      gate: gatePayload(["operators", "admins"], cohort({ candidates: [candidate({ validation: undefined })] })),
    }),
    "revisao",
  );
  assert.match(pending, /data-human-gate="validate"/);
  assert.match(html, /data-review-cohort="[^"]*" data-editorial-state="CURRENT" data-actionable="true"/);
  assert.doesNotMatch(html, /data-legacy-banner="true"/);
  assert.doesNotMatch(html, /data-non-actionable-notice="true"/);
  assert.doesNotMatch(html, /data-non-actionable-surface="true"/);
});

test("an absent editorial_state is an older backend, not a historical version", () => {
  reset();
  const html = warmblyBlock(surfaceInput(), "revisao");
  assert.match(html, /data-editorial-state="CURRENT"/);
  assert.doesNotMatch(html, /data-legacy-banner="true"/);
  assert.match(html, /data-human-gate="decide"/);
  assert.match(html, /data-human-gate="review"/);
});

test("actionable:false alone is enough to withdraw the controls", () => {
  reset();
  const html = warmblyBlock(
    surfaceInput({ gate: gatePayload(["operators", "admins"], cohort({ actionable: false })) }),
    "revisao",
  );
  assert.match(html, /data-legacy-banner="true"/);
  assert.doesNotMatch(html, /data-human-gate="decide"/);
});

test("a non-actionable candidate loses its controls even inside a current version", () => {
  reset();
  const html = warmblyBlock(
    surfaceInput({
      gate: gatePayload(
        ["operators", "admins"],
        cohort({
          candidates: [
            candidate({
              editorial_state: "LEGACY_SUPERSEDED",
              editorial_reason_codes: ["composer_unstamped"],
            }),
          ],
        }),
      ),
    }),
    "revisao",
  );
  assert.match(html, /data-editorial-state="LEGACY_SUPERSEDED"/, "the card carries the candidate's own state");
  assert.doesNotMatch(html, /data-human-gate="review"/);
  assert.doesNotMatch(html, /data-adjust-editor=/);
  assert.match(html, /data-human-gate="decide"/, "the version itself is still decidable");
  assert.ok(html.includes("sem carimbo de redator"));
});

// 13. The frozen message preview shows the message and nothing else.
//
// The CTA was rendered as its own paragraph directly under the body, inside the
// same disclosure, and it repeats the body's closing paragraph verbatim. A
// founder reading it top to bottom saw a labelled line after the sign-off and
// could not tell whether it would be sent. It is internal annotation, the
// recipient never sees it, and it says nothing the body has not already said.
test("the frozen message preview carries the message only, with no annotation that could read as sent text", () => {
  reset();
  const html = warmblyBlock(surfaceInput(), "revisao");
  const previews = html.match(/<details data-message-preview="true"[\s\S]*?<\/details>/g) ?? [];
  assert.ok(previews.length > 0, "the frozen message preview must render");
  for (const preview of previews) {
    assert.ok(
      !preview.includes("Chamada para ação"),
      "no internal label may appear inside the frozen message preview",
    );
    assert.ok(!preview.includes("data-cta"), "the CTA annotation must not sit inside the message");
    assert.ok(preview.includes("data-exact-subject"), "the subject stays");
    assert.ok(preview.includes("data-exact-body"), "the body stays");
  }
});

test("a historical version's message preview is equally free of annotation", () => {
  reset();
  const html = warmblyBlock(legacyInput(), "revisao");
  const previews = html.match(/<details data-message-preview="true"[\s\S]*?<\/details>/g) ?? [];
  assert.ok(previews.length > 0);
  for (const preview of previews) {
    assert.ok(!preview.includes("Chamada para ação"));
    assert.ok(preview.includes("data-exact-body"));
  }
});

// 14. A legacy version that is also the newest version of its cohort is a dead
// end: there is no current version to open, and saying "the server did not say"
// blames a data gap for what is actually the cohort's real state.
test("a legacy version with no successor says so instead of blaming the server", () => {
  reset();
  const html = warmblyBlock(legacyInput({ is_current_version: true, current_version_id: "" }), "revisao");
  assert.match(html, /data-open-current="none"/);
  assert.ok(html.includes("prepare uma cohort nova"), "must name the way forward");
  assert.ok(!html.includes("O servidor não informou qual é a versão corrente"), "must not blame the server");
  assert.match(html, /data-legacy-banner="true"/);
  assert.ok(!/data-human-gate="(review|decide|adjust|validate)"/.test(html), "still no controls");
});

test("a legacy version that does have a successor still links to it", () => {
  reset();
  const html = warmblyBlock(
    legacyInput({ is_current_version: false, current_version_id: "11111111-2222-3333-4444-555555555555" }),
    "revisao",
  );
  assert.match(html, /data-open-current="true"/);
  assert.ok(html.includes("Abrir versão corrente"));
});

/* ------------------------------------------------------------------ *
 * A fila de revisão.
 *
 * Every test below pins something the old surface got wrong in real use: an
 * approved message that stayed at the top of the list, a reviewer scrolling to
 * find the next pending one, a preparatory click on "verificar destinatário", a
 * required motive nobody read, and a checkbox declaring the click that had just
 * been made.
 * ------------------------------------------------------------------ */

const SECOND_CANDIDATE = "33333333-3333-4333-8333-333333333333";
const THIRD_CANDIDATE = "44444444-4444-4444-8444-444444444444";

/** Three members, one in each queue state, so a recorte can be told apart. */
function mixedCohort(): Record<string, unknown> {
  return cohort({
    candidates: [
      candidate({ company: "Pendente SA" }),
      candidate({
        candidate_id: SECOND_CANDIDATE,
        company: "Aprovada SA",
        review: { decision: "APPROVE", effective: true },
      }),
      candidate({
        candidate_id: THIRD_CANDIDATE,
        company: "Segurada SA",
        review: { decision: "HOLD", effective: false },
      }),
    ],
  });
}

test("a fila abre em pendentes, e o trabalho já feito não disputa espaço com o que falta", () => {
  reset();
  const gate = gatePayload(["operators", "admins"], mixedCohort());
  const html = warmblyBlock(surfaceInput({ gate }), "revisao");
  assert.match(html, /data-queue-filter="pendentes"/);
  assert.match(html, /data-queue-pending="1" data-queue-approved="1" data-queue-adjust="1" data-queue-total="3"/);
  assert.ok(html.includes("Pendente SA"), "a pendente precisa estar na tela");
  assert.ok(!html.includes("Aprovada SA"), "a aprovada saiu da fila operacional");
  assert.ok(!html.includes("Segurada SA"), "a segurada saiu da fila operacional");

  const all = warmblyBlock(surfaceInput({ gate, query: ALL_STATES }), "revisao");
  for (const company of ["Pendente SA", "Aprovada SA", "Segurada SA"]) {
    assert.ok(all.includes(company), `${company} precisa continuar legível em Todas`);
  }
});

test("o progresso da fila é dito em números, e cada recorte carrega o seu", () => {
  reset();
  const html = warmblyBlock(
    surfaceInput({ gate: gatePayload(["operators", "admins"], mixedCohort()) }),
    "revisao",
  );
  const progress = html.match(/<h3 data-queue-progress-text="true">([^<]*)<\/h3>/);
  assert.ok(progress, "a linha de progresso precisa existir");
  assert.match(progress[1]!, /1 pendente\(s\).*1 aprovada\(s\).*1 em ajuste.*3 no total/);
  assert.match(html, /data-review-filter="pendentes" aria-current="page">Pendentes \(1\)/);
  assert.match(html, /data-review-filter="aprovadas" aria-current="false">Aprovadas \(1\)/);
  assert.match(html, /data-review-filter="ajuste" aria-current="false">Ajuste ou rejeitadas \(1\)/);
  assert.match(html, /data-review-filter="todas" aria-current="false">Todas \(3\)/);
});

test("um link de recorte nunca larga a versão selecionada nem o estado das mensagens", () => {
  reset();
  const html = warmblyBlock(
    surfaceInput({
      gate: gatePayload(["operators", "admins"], mixedCohort()),
      query: `resource=${COHORT_ID}&mensagens=recolhidas`,
    }),
    "revisao",
  );
  const hrefs = [...html.matchAll(/data-review-filter="([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(hrefs, ["pendentes", "aprovadas", "ajuste", "todas"]);
  const aprovadas = html.match(/href="([^"]*)" data-review-filter="aprovadas"/);
  assert.ok(aprovadas);
  assert.ok(aprovadas[1]!.includes(`resource=${COHORT_ID}`), "a versão selecionada viaja com o recorte");
  assert.ok(aprovadas[1]!.includes("mensagens=recolhidas"), "o recorte não desfaz a escolha de leitura");
  assert.ok(aprovadas[1]!.includes(`${REVIEW_QUEUE_PARAM}=aprovadas`));
  // O padrão não polui a URL: pendentes é a ausência do parâmetro.
  const pendentes = html.match(/href="([^"]*)" data-review-filter="pendentes"/);
  assert.ok(pendentes);
  assert.ok(!pendentes[1]!.includes(REVIEW_QUEUE_PARAM));
});

test("com tudo decidido a fila diz que acabou e aponta o GO, em vez de uma tela vazia", () => {
  reset();
  const done = cohort({
    candidates: [
      candidate({ review: { decision: "APPROVE", effective: true } }),
      candidate({
        candidate_id: SECOND_CANDIDATE,
        review: { decision: "APPROVE", effective: true },
      }),
    ],
  });
  const html = warmblyBlock(
    surfaceInput({ gate: gatePayload(["operators", "admins"], done) }),
    "revisao",
  );
  assert.match(html, /data-queue-empty="pendentes"/);
  assert.ok(html.includes("Fila vazia"));
  assert.ok(html.includes("GO/NO-GO"), "o próximo passo precisa estar nomeado");
  assert.match(html, /data-queue-see-all="true"/);
  // A cohort vazia continua sendo outra coisa: ali GO está bloqueado.
  const empty = warmblyBlock(
    surfaceInput({ gate: gatePayload(["operators", "admins"], cohort({ candidates: [] })) }),
    "revisao",
  );
  assert.ok(empty.includes("Cohort vazia: GO bloqueado."));
});

test("um recorte vazio que não é pendentes diz que só o recorte está vazio", () => {
  reset();
  const html = warmblyBlock(
    surfaceInput({
      gate: gatePayload(["operators", "admins"], cohort()),
      query: `${REVIEW_QUEUE_PARAM}=aprovadas`,
    }),
    "revisao",
  );
  assert.match(html, /data-queue-empty="aprovadas"/);
  assert.ok(html.includes("Nada foi escondido"));
});

test("um candidato aprovado não oferece aprovar de novo, e mantém segurar e ajustar", () => {
  reset();
  const html = warmblyBlock(
    surfaceInput({
      gate: gatePayload(
        ["operators", "admins"],
        cohort({ candidates: [candidate({ review: { decision: "APPROVE", effective: true } })] }),
      ),
      query: ALL_STATES,
    }),
    "revisao",
  );
  assert.match(html, /data-queue-state="aprovado"/);
  assert.match(html, /data-already-approved="server"/);
  assert.ok(!/data-gate-key="review:[^"]*:APPROVE"/.test(html), "não pode haver segundo APPROVE");
  assert.match(html, /data-gate-key="review:[^"]*:HOLD_REJECT"/, "reverter continua possível");
  assert.match(html, /data-adjust-editor=/, "ajustar continua possível");
});

/* ------------------------------------------------------------------ *
 * Uma decisão, uma ação.
 * ------------------------------------------------------------------ */

/**
 * A gate that behaves like Warmbly: a review it accepts is a review its next
 * GET reports.
 *
 * A mock that accepts writes and keeps answering the old payload would make the
 * readback say `not_confirmed` on every call, which is a different scenario —
 * pinned separately below — and would hide whether the queue really drains.
 */
function statefulGate(initial: Record<string, unknown>[]): {
  gate: () => Record<string, unknown>;
  respond: (input: WarmblyGateInput) => AdapterWriteResult;
} {
  const rows = initial.map((row) => ({ ...row }));
  return {
    gate: () =>
      gatePayload(["operators", "admins"], cohort({ candidates: rows.map((row) => ({ ...row })) })),
    respond: (input) => {
      if (input.action === "review") {
        const row = rows.find((entry) => entry.candidate_id === input.candidate_id);
        if (row) {
          row.review = { decision: input.decision, effective: input.decision === "APPROVE" };
        }
      }
      if (input.action === "validate") {
        const row = rows.find((entry) => entry.candidate_id === input.candidate_id);
        if (row) {
          row.validation = { status: "VALID", reason: "verificado no teste" };
          row.blocked_by = [];
        }
      }
      return {
        ok: true,
        path: "/x",
        kind: "nota" as const,
        message: "registrado",
        outcome: "executed",
        gateAction: input.action,
      };
    },
  };
}

/** Fires the approve control of a painted candidate, exactly as a click would. */
function approve(dom: ReturnType<typeof paintingRoot>, candidateId = CANDIDATE_ID): FakeElement {
  const form = dom.find(`[data-gate-key="review:${COHORT_ID}:${candidateId}:APPROVE"]`);
  form.fire();
  return form;
}

test("aprovar é uma única ação: sem motivo digitado, sem caixa de ciência, uma escrita só", async () => {
  reset();
  const { adapter, seen } = gateAdapter({
    respond: () => ({
      ok: true,
      path: "/x",
      kind: "nota" as const,
      message: "APPROVE registrado.",
      outcome: "executed",
      gateAction: "review" as const,
    }),
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  approve(dom);
  await settle();
  assert.equal(seen.length, 1, "o caminho feliz custa exatamente uma escrita");
  assert.equal(seen[0]!.action, "review");
  assert.equal(seen[0]!.decision, "APPROVE");
  assert.equal(seen[0]!.acknowledged, true, "o clique é a ciência e viaja como tal");
  assert.equal(seen[0]!.reason, "approved_by_human_reviewer");
});

test("o comentário opcional, quando escrito, vence o motivo padrão", async () => {
  reset();
  const { adapter, seen } = gateAdapter({
    respond: () => ({
      ok: true,
      path: "/x",
      kind: "nota" as const,
      message: "APPROVE registrado.",
      outcome: "executed",
      gateAction: "review" as const,
    }),
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  const form = dom.find(`[data-gate-key="review:${COHORT_ID}:${CANDIDATE_ID}:APPROVE"]`);
  form.set("reason", "conferi o edital citado no corpo");
  form.fire();
  await settle();
  assert.equal(seen[0]!.reason, "conferi o edital citado no corpo");
});

test("a chave de idempotência de uma aprovação comum é estável entre tentativas", async () => {
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
  approve(dom);
  await settle();
  approve(dom);
  await settle();
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.idempotency_key, seen[1]!.idempotency_key, "a intenção incerta repete idêntica");
});

/* ------------------------------------------------------------------ *
 * Verificação do destinatário: máquina, não burocracia.
 * ------------------------------------------------------------------ */

/** A gate payload whose candidate gains a validation once one has been asked for. */
function validatingGate(status: string): {
  gate: () => Record<string, unknown>;
  validated: () => boolean;
  markValidated: () => void;
} {
  let done = false;
  return {
    gate: () =>
      gatePayload(
        ["operators", "admins"],
        cohort({
          candidates: [
            candidate({
              validation: done ? { status } : undefined,
              blocked_by: done ? [] : ["validation_missing"],
            }),
          ],
        }),
      ),
    validated: () => done,
    markValidated: () => {
      done = true;
    },
  };
}

test("aprovar um candidato sem verificação vigente pede a verificação e só então registra", async () => {
  reset();
  const state = validatingGate("VALID");
  const { adapter, seen } = gateAdapter({
    gate: state.gate,
    respond: (input) => {
      if (input.action === "validate") state.markValidated();
      return {
        ok: true,
        path: "/x",
        kind: "nota" as const,
        message: input.action === "validate" ? "verificação pedida" : "APPROVE registrado.",
        outcome: "executed",
        gateAction: input.action,
      };
    },
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  assert.match(dom.root.innerHTML, /data-approve-needs-validation="true"/);
  approve(dom);
  await settle();
  assert.deepEqual(seen.map((call) => call.action), ["validate", "review"]);
  assert.equal(seen[1]!.decision, "APPROVE");
  assert.equal(seen[1]!.acknowledged, true);
});

test("uma verificação que volta diferente de VALID interrompe a cadeia: o APPROVE não é tentado", async () => {
  reset();
  const state = validatingGate("RISKY");
  const { adapter, seen } = gateAdapter({
    gate: state.gate,
    respond: (input) => {
      if (input.action === "validate") state.markValidated();
      return {
        ok: true,
        path: "/x",
        kind: "nota" as const,
        message: "verificação pedida",
        outcome: "executed",
        gateAction: input.action,
      };
    },
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  approve(dom);
  await settle();
  assert.deepEqual(seen.map((call) => call.action), ["validate"]);
  assert.match(dom.root.innerHTML, /data-outcome-code="approval_validation_not_valid"/);
  assert.ok(dom.root.innerHTML.includes("RISKY"), "o estado observado precisa ser dito");
  assert.ok(dom.root.innerHTML.includes("O APPROVE não foi enviado"));
  // E o candidato continua na fila de pendências.
  assert.match(dom.root.innerHTML, /data-queue-state="pendente"/);
});

test("uma verificação recusada interrompe a cadeia e diz que a aprovação não foi tentada", async () => {
  reset();
  const state = validatingGate("VALID");
  const { adapter, seen } = gateAdapter({
    gate: state.gate,
    respond: () => ({
      ok: false,
      path: "/x",
      kind: "nota" as const,
      message: "o verificador recusou",
      outcome: "refused",
      code: "upstream_error",
      gateAction: "validate" as const,
    }),
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  approve(dom);
  await settle();
  assert.deepEqual(seen.map((call) => call.action), ["validate"]);
  assert.match(dom.root.innerHTML, /data-outcome-code="approval_validation_unavailable"/);
  assert.ok(dom.root.innerHTML.includes("A verificação do destinatário não completou"));
  assert.match(dom.root.innerHTML, /data-queue-state="pendente"/);
});

/* ------------------------------------------------------------------ *
 * Otimismo com rollback.
 * ------------------------------------------------------------------ */

test("a aprovação sai da fila na hora e a próxima assume a posição, com o foco junto", async () => {
  reset();
  const server = statefulGate([
    candidate({ company: "Primeira SA" }),
    candidate({ candidate_id: SECOND_CANDIDATE, company: "Segunda SA" }),
  ]);
  const { adapter } = gateAdapter({ gate: server.gate, respond: server.respond });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  assert.match(dom.root.innerHTML, /data-queue-pending="2"/);
  approve(dom);
  await settle();
  assert.match(dom.root.innerHTML, /data-queue-pending="1"/);
  assert.ok(!dom.root.innerHTML.includes("Primeira SA"), "a aprovada saiu da viewport de trabalho");
  assert.ok(dom.root.innerHTML.includes("Segunda SA"), "a próxima assumiu a posição");
  const next = dom.all("[data-approve-submit]")[0];
  assert.ok(next?.focused, "o foco precisa cair no próximo Aprovar");
  assert.ok(next?.centred, "e a próxima mensagem precisa ficar centrada, sem salto de página");
});

test("o card sai da fila antes da resposta chegar, e a espera fica dita na própria fila", async () => {
  reset();
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = statefulGate([
    candidate({ company: "Primeira SA" }),
    candidate({ candidate_id: SECOND_CANDIDATE, company: "Segunda SA" }),
  ]);
  const { adapter } = gateAdapter({
    gate: server.gate,
    respond: async (input) => {
      await held;
      return server.respond(input);
    },
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  approve(dom);
  await settle();
  // A escrita ainda está no ar e a fila já mostra a próxima mensagem.
  assert.match(dom.root.innerHTML, /data-queue-pending="1"/);
  assert.ok(!dom.root.innerHTML.includes("Primeira SA"));
  assert.match(dom.root.innerHTML, /data-write-pending="true"/, "a espera precisa estar visível");
  assert.ok(dom.root.innerHTML.includes("Registrando a decisão de 1 candidato"));
  release?.();
  await settle();
  assert.doesNotMatch(dom.root.innerHTML, /data-write-pending="true"/);
  assert.match(dom.root.innerHTML, /data-queue-pending="1"/);
});

test("uma recusa da API devolve a mensagem para a fila e explica o motivo no card", async () => {
  reset();
  const { adapter } = gateAdapter({
    respond: () => ({
      ok: false,
      path: "/x",
      kind: "nota" as const,
      message: "o servidor recusou",
      outcome: "refused",
      code: "upstream_error",
      gateAction: "review" as const,
    }),
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  approve(dom);
  await settle();
  assert.match(dom.root.innerHTML, /data-queue-pending="1"/, "a mensagem volta a ser trabalho");
  assert.match(dom.root.innerHTML, /data-queue-state="pendente"/);
  assert.match(dom.root.innerHTML, /data-write-result="failed"/);
  assert.match(dom.root.innerHTML, /data-gate-key="review:[^"]*:APPROVE"/, "e pode ser aprovada de novo");
});

test("um desfecho desconhecido não conta como aprovado: a mensagem fica na fila com o aviso", async () => {
  reset();
  const { adapter } = gateAdapter({
    respond: () => ({
      ok: false,
      path: "/x",
      kind: "nota" as const,
      message: "sem resposta",
      outcome: "unknown",
      code: "human_gate_transport_unknown",
      gateAction: "review" as const,
    }),
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  approve(dom);
  await settle();
  assert.match(dom.root.innerHTML, /data-queue-pending="1"/);
  assert.match(dom.root.innerHTML, /data-dispatch-outcome="unknown"/);
});

test("uma releitura que não confirma o efeito devolve a mensagem para a fila", async () => {
  reset();
  const { adapter } = gateAdapter({
    // A releitura devolve o candidato sem revisão nenhuma, então o canal
    // aceitou e o recurso não mudou. Isso não é aprovado.
    gate: () => gatePayload(["operators", "admins"], cohort()),
    respond: () => ({
      ok: true,
      path: "/x",
      kind: "nota" as const,
      message: "APPROVE registrado.",
      outcome: "executed",
      gateAction: "review" as const,
    }),
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  approve(dom);
  await settle();
  assert.match(dom.root.innerHTML, /data-readback="not_confirmed"/);
  assert.match(dom.root.innerHTML, /data-queue-pending="1"/, "sem confirmação, continua sendo trabalho");
});

test("um duplo clique em Aprovar não vira duas aprovações, nem durante a verificação", async () => {
  reset();
  const state = validatingGate("VALID");
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { adapter, seen } = gateAdapter({
    gate: state.gate,
    respond: async (input) => {
      if (input.action === "validate") {
        await held;
        state.markValidated();
      }
      return {
        ok: true,
        path: "/x",
        kind: "nota" as const,
        message: "ok",
        outcome: "executed",
        gateAction: input.action,
      };
    },
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  approve(dom);
  await settle();
  assert.match(dom.root.innerHTML, /data-write-pending="true"/);
  // O segundo clique acontece com a verificação ainda no ar.
  const stillThere = dom.root.querySelectorAll(
    `[data-gate-key="review:${COHORT_ID}:${CANDIDATE_ID}:APPROVE"]`,
  );
  stillThere[0]?.fire();
  await settle();
  assert.equal(seen.length, 1, "a segunda intenção não pode alcançar o canal");
  release?.();
  await settle();
  assert.deepEqual(seen.map((call) => call.action), ["validate", "review"]);
});

test("cinquenta pendências: a fila conta certo, mostra só o que falta e drena uma a uma", async () => {
  reset();
  const ids = Array.from(
    { length: 50 },
    (_, index) => `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
  );
  const server = statefulGate(
    ids.map((id, index) => candidate({ candidate_id: id, company: `Empresa ${index}` })),
  );
  const { adapter } = gateAdapter({ gate: server.gate, respond: server.respond });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  assert.match(dom.root.innerHTML, /data-queue-pending="50" data-queue-approved="0"/);
  for (let index = 0; index < 18; index += 1) {
    dom.find(`[data-gate-key="review:${COHORT_ID}:${ids[index]}:APPROVE"]`).fire();
    await settle();
  }
  assert.match(dom.root.innerHTML, /data-queue-pending="32" data-queue-approved="18" data-queue-adjust="0" data-queue-total="50"/);
  const remaining = dom.all("[data-approve-submit]");
  assert.equal(remaining.length, 32, "só o que falta ocupa a tela");
  // Nenhuma das aprovadas reaparece, mesmo com o servidor devolvendo o payload
  // original em toda releitura.
  for (let index = 0; index < 18; index += 1) {
    assert.ok(
      !dom.root.innerHTML.includes(`review:${COHORT_ID}:${ids[index]}:APPROVE`),
      `a aprovação ${index} não pode voltar para a fila`,
    );
  }
});

test("segurar também tira da fila de pendências, e o motivo continua obrigatório", async () => {
  reset();
  const server = statefulGate([candidate()]);
  const { adapter, seen } = gateAdapter({ gate: server.gate, respond: server.respond });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  const form = dom.find(`[data-gate-key="review:${COHORT_ID}:${CANDIDATE_ID}:HOLD_REJECT"]`);
  form.set("reason", "endereço genérico demais");
  form.fire();
  await settle();
  assert.equal(seen[0]!.decision, "HOLD");
  assert.equal(seen[0]!.acknowledged, undefined, "segurar nunca carrega ciência de aprovação");
  assert.match(dom.root.innerHTML, /data-queue-pending="0" data-queue-approved="0" data-queue-adjust="1"/);
});

/* ------------------------------------------------------------------ *
 * Teclado.
 * ------------------------------------------------------------------ */

test("o atalho de aprovar não dispara com o cursor dentro de um campo", () => {
  for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
    assert.equal(isEditingTarget({ tagName: tag }), true, `${tag} é escrita, não decisão`);
    assert.equal(approvalShortcutScope({ key: "a" }, isEditingTarget({ tagName: tag })), null);
    assert.equal(
      approvalShortcutScope({ key: "Enter", ctrlKey: true }, isEditingTarget({ tagName: tag })),
      null,
    );
  }
  assert.equal(isEditingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isEditingTarget({ tagName: "BUTTON" }), false, "o botão é onde a fila deixa o foco");
  assert.equal(isEditingTarget(null), false);
});

test("o atalho é A sozinho ou Ctrl/Cmd+Enter, e nada mais", () => {
  // A sozinho só alcança o card que já está sob o foco: um "a" digitado por
  // engano em qualquer outro lugar não autoriza mensagem nenhuma.
  assert.equal(approvalShortcutScope({ key: "a" }, false), "focused-card");
  assert.equal(approvalShortcutScope({ key: "A" }, false), "focused-card");
  assert.equal(approvalShortcutScope({ key: "Enter", ctrlKey: true }, false), "first-pending");
  assert.equal(approvalShortcutScope({ key: "Enter", metaKey: true }, false), "first-pending");
  // Ctrl+A continua sendo selecionar tudo, e Enter sozinho continua sendo Enter.
  assert.equal(approvalShortcutScope({ key: "a", ctrlKey: true }, false), null);
  assert.equal(approvalShortcutScope({ key: "a", metaKey: true }, false), null);
  assert.equal(approvalShortcutScope({ key: "a", shiftKey: true }, false), null);
  assert.equal(approvalShortcutScope({ key: "a", altKey: true }, false), null);
  assert.equal(approvalShortcutScope({ key: "Enter" }, false), null);
  assert.equal(approvalShortcutScope({ key: "b" }, false), null);
  assert.equal(approvalShortcutScope({}, false), null);
});

test("um canal que morre sem responder devolve a mensagem para a fila como desfecho desconhecido", async () => {
  reset();
  const { adapter } = gateAdapter({
    respond: () => {
      throw new Error("o canal caiu");
    },
  });
  const dom = paintingRoot();
  paintShell(dom.root as never, adapter as never, `#/warmbly/revisao?resource=${COHORT_ID}`);
  approve(dom);
  await settle();
  assert.match(dom.root.innerHTML, /data-outcome-code="browser_transport"/);
  assert.match(dom.root.innerHTML, /data-queue-pending="1"/, "sem prova de aplicação, continua sendo trabalho");
  assert.match(dom.root.innerHTML, /data-gate-key="review:[^"]*:APPROVE"/, "e o controle volta pressionável");
});

test("reverter uma aprovação com HOLD leva a mensagem para o recorte de ajuste", async () => {
  reset();
  const server = statefulGate([candidate({ review: { decision: "APPROVE", effective: true } })]);
  const { adapter, seen } = gateAdapter({ gate: server.gate, respond: server.respond });
  const dom = paintingRoot();
  paintShell(
    dom.root as never,
    adapter as never,
    `#/warmbly/revisao?resource=${COHORT_ID}&${REVIEW_QUEUE_PARAM}=todas`,
  );
  assert.match(dom.root.innerHTML, /data-already-approved="server"/);
  const form = dom.find(`[data-gate-key="review:${COHORT_ID}:${CANDIDATE_ID}:HOLD_REJECT"]`);
  form.set("reason", "o edital citado foi revogado");
  form.fire();
  await settle();
  assert.equal(seen[0]!.decision, "HOLD");
  assert.match(dom.root.innerHTML, /data-queue-approved="0" data-queue-adjust="1"/);
  assert.match(dom.root.innerHTML, /data-gate-key="review:[^"]*:APPROVE"/, "e aprovar volta a ser oferecido");
});
