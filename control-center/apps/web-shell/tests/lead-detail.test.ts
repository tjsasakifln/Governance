import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpAdapter } from "../src/adapters/http";
import { consumeQueueFocus, createMemoryRuntime, mount, paintShell } from "../src/app";
import type { AdapterReadResult, DestinationPage } from "../src/adapters/contract";
import type { CommercialSnapshot } from "../src/types";
import {
  WARMBLY_TARGET_ID_PATTERN,
  isOpaqueIdentifier,
  leadDetailBlock,
  leadDetailHash,
  leadDetailView,
  leadTitleOf,
  queueFocusDomId,
  queueFocusToken,
  queueBackHash,
} from "../src/ui/lead-detail";
import { recordingFetch } from "./helpers";

const OPAQUE = "warmbly:action:6f2c1f7a-6b4e-4a1e-9c3d-2f7b8a5e1c44:next_action";
const DEAL_ID = "deal_7cGh-42";
const INBOUND_LEAD_ID = "lead_7cGh-42";

function snapshotWith(operations: Record<string, unknown>): CommercialSnapshot {
  return {
    schema_version: "control-center.commercial-snapshot.v1",
    id: "cc:commercial-snapshot:test",
    scope: "commercial",
    generated_at: "2026-08-20T18:00:00Z",
    provenance: {
      source: { system: "warmbly", kind: "crm-read-model", locator: "commercial/pipeline" },
      observed_at: "2026-08-20T17:39:00Z",
      freshness_status: "FRESH",
      confidence: 0.84,
    },
    authority: {
      catalog_authority: "governance",
      commercial_runtime: "warmbly",
      this_document: "read_model",
    },
    operations,
  };
}

/** Shape emitted by `connectors/runner/src/projectors/commercial.ts`. */
function representativeOperations(): Record<string, unknown> {
  return {
    schema_version: "control-center.commercial-operations.v1",
    activity: [
      {
        at: "2026-08-20T17:30:00Z",
        lead_or_account: "Metalúrgica Andrade",
        source_id: DEAL_ID,
        event: "proposal_sent",
        state: "open",
        evidence: "proposta v3 enviada por e-mail",
      },
      {
        at: "2026-08-19T09:00:00Z",
        lead_or_account: "Metalúrgica Andrade",
        source_id: DEAL_ID,
        event: "qualified",
        state: "open",
        evidence: "respondeu pedindo escopo",
      },
      {
        at: "2026-08-20T12:00:00Z",
        lead_or_account: OPAQUE,
        source_id: OPAQUE,
        event: "next_action",
        state: null,
        evidence: "próxima ação sem responsável",
      },
    ],
    pipeline: [
      {
        id: DEAL_ID,
        canonical_id: `cc:commercial-deal:${DEAL_ID}`,
        source_id: DEAL_ID,
        display_name: "Metalúrgica Andrade",
        stage: "Proposta",
        status: "open",
        next_action: "confirmar escopo com o engenheiro responsável",
        age_seconds: 259200,
        stale: false,
        value: { amount_cents: 4800000, currency: "BRL" },
      },
    ],
    exceptions: [
      {
        id: OPAQUE,
        canonical_id: "cc:attention-item:warmbly-action-6f2c1f7a-next-action",
        source_id: OPAQUE,
        why: "oportunidade sem próxima ação há 9 dias",
        kind: "missing_next_action",
        recommended_next_action: "definir próxima ação no Warmbly",
        status: "open",
        source: "warmbly.intel.exceptions",
        observed_at: "2026-08-20T12:00:00Z",
        evidence: { code: "missing_next_action", days: 9 },
      },
      {
        id: `alert_${DEAL_ID}`,
        canonical_id: `cc:attention-item:alert-${DEAL_ID}`,
        source_id: DEAL_ID,
        why: "inbound sem leitura há 2 dias",
        kind: "inbound_unread",
        recommended_next_action: "ler e responder no Warmbly",
        status: "open",
        source: "warmbly.attention",
        observed_at: "2026-08-20T16:00:00Z",
        evidence: {
          code: "inbound_unread",
          entity_ref: { type: "inbound_lead", id: INBOUND_LEAD_ID },
          lead_id: INBOUND_LEAD_ID,
        },
      },
    ],
  };
}

/** Text a human actually reads: no collapsed technical block, no markup. */
function visibleTextOf(html: string): string {
  return html
    .replace(/<details class="lead-technical"[\s\S]*?<\/details>/g, "")
    .replace(/<[^>]*>/g, " ");
}

/** Reading surface only: collapsed diagnostics and element attributes are excluded. */
function readingTextOf(html: string): string {
  return html
    .replace(/<details\b[\s\S]*?<\/details>/g, "")
    .replace(/<[^>]*>/g, " ");
}

test("an opaque handle is recognised as a handle and a company name is not", () => {
  assert.equal(isOpaqueIdentifier(OPAQUE), true);
  assert.equal(isOpaqueIdentifier("6f2c1f7a-6b4e-4a1e-9c3d-2f7b8a5e1c44"), true);
  assert.equal(isOpaqueIdentifier("01ARZ3NDEKTSV4RRFFQ69G5FAV"), true);
  assert.equal(isOpaqueIdentifier("unknown"), true);
  assert.equal(isOpaqueIdentifier(""), true);
  assert.equal(isOpaqueIdentifier("Metalúrgica Andrade"), false);
  assert.equal(isOpaqueIdentifier("Prefeitura de Joinville"), false);
  assert.equal(leadTitleOf({ lead_or_account: OPAQUE, source_id: OPAQUE }), null);
  assert.equal(leadTitleOf({ display_name: "Metalúrgica Andrade" }), "Metalúrgica Andrade");
});

test("the detail link carries queue state forward and the back link gives it back", () => {
  const queue = "q=andrade&stage=proposta&sort=idade&page=3";
  const forward = leadDetailHash("atividade", queue, DEAL_ID, { index: 4, total: 12 });
  assert.match(forward, /^#\/comercial\/atividade\?/);
  const forwardParams = new URLSearchParams(forward.split("?")[1]);
  assert.equal(forwardParams.get("q"), "andrade");
  assert.equal(forwardParams.get("stage"), "proposta");
  assert.equal(forwardParams.get("sort"), "idade");
  assert.equal(forwardParams.get("page"), "3");
  assert.equal(forwardParams.get("resource"), DEAL_ID);
  assert.equal(forwardParams.get("pos"), "4");
  assert.equal(forwardParams.get("of"), "12");

  const back = queueBackHash("atividade", forward.split("?")[1], DEAL_ID);
  const backParams = new URLSearchParams(back.split("?")[1]);
  assert.equal(backParams.get("q"), "andrade");
  assert.equal(backParams.get("stage"), "proposta");
  assert.equal(backParams.get("sort"), "idade");
  assert.equal(backParams.get("page"), "3");
  assert.equal(backParams.get("resource"), null, "the subject must not survive the back link");
  assert.equal(backParams.get("pos"), null);
  assert.equal(backParams.get("of"), null);
  assert.equal(
    backParams.get("focus"),
    queueFocusToken(DEAL_ID, { index: 4, total: 12 }),
    "the queue needs the exact row occurrence, not only its possibly duplicated resource",
  );

  // A caller that owns its own route passes a full hash path and keeps it.
  assert.match(
    leadDetailHash("#/warmbly/fila", "q=andrade", DEAL_ID),
    /^#\/warmbly\/fila\?/,
  );
  assert.match(queueBackHash("#/warmbly/fila", "q=andrade", DEAL_ID), /^#\/warmbly\/fila\?/);
});

test("a detail assembles organisation, stage, next step, history and evidence from the snapshot", () => {
  const model = leadDetailView({
    snapshot: snapshotWith(representativeOperations()),
    resource: DEAL_ID,
    query: "pos=4&of=12",
  });
  assert.equal(model.found, true);
  assert.equal(model.title, "Metalúrgica Andrade");
  assert.equal(model.titleFromOrigin, true);
  const byLabel = new Map(model.fields.map((field) => [field.label, field]));
  assert.equal(byLabel.get("Estágio")?.value, "Proposta");
  assert.equal(byLabel.get("Próximo passo")?.value, "confirmar escopo com o engenheiro responsável");
  assert.equal(byLabel.get("Origem")?.value, "Warmbly · leitura comercial");
  // No owner is projected upstream today: the field is present and absent, not
  // silently dropped and not invented.
  assert.equal(byLabel.get("Responsável")?.value, null);
  assert.match(byLabel.get("Responsável")?.absence ?? "", /não informado pela origem/);
  assert.deepEqual(
    model.history.map((entry) => entry.event),
    ["proposal_sent", "inbound_unread", "qualified"],
    "history merges activity and exceptions, newest first",
  );
  assert.equal(model.queuePosition?.index, 4);
  assert.equal(model.queuePosition?.total, 12);
  assert.ok(model.evidence.some((row) => row.value.includes("BRL 48.000,00")));
  // The local record is filed against the canonical id, not the raw handle.
  assert.equal(model.canonicalId, `cc:commercial-deal:${DEAL_ID}`);
  const html = leadDetailBlock({ snapshot: snapshotWith(representativeOperations()), resource: DEAL_ID });
  assert.match(
    html,
    new RegExp(`name="target_canonical_id" value="cc:commercial-deal:${DEAL_ID}"`),
  );
});

test("lead detail presents known origin and history labels while keeping source locators technical", () => {
  const snapshot = snapshotWith(representativeOperations());
  const root = { innerHTML: "" };
  paintShell(root, adapterFor(snapshot), `#/comercial/atividade?resource=${DEAL_ID}`);

  const reading = readingTextOf(root.innerHTML);
  assert.match(reading, /Warmbly · leitura comercial/);
  assert.match(reading, /Warmbly · atividade comercial/);
  assert.match(reading, /Warmbly · fila de atenção/);
  assert.doesNotMatch(reading, /commercial\/pipeline/);
  assert.doesNotMatch(reading, /warmbly\.attention/);

  assert.match(root.innerHTML, /locator=commercial\/pipeline/);
  assert.match(root.innerHTML, /data-history-source="warmbly\.attention"/);
  assert.match(root.innerHTML, /source=warmbly\.attention/);
});

test("lead detail gives future provenance and history sources authored fallbacks", () => {
  const operations = representativeOperations();
  for (const row of operations.activity as Record<string, unknown>[]) {
    row.source = "FUTURE_ACTIVITY_SOURCE";
  }
  for (const row of operations.exceptions as Record<string, unknown>[]) {
    row.source = "FUTURE_HISTORY_SOURCE";
  }
  const snapshot = snapshotWith(operations);
  snapshot.provenance.source = {
    system: "FUTURE_SOURCE_SYSTEM",
    kind: "FUTURE_SOURCE_KIND",
    locator: "FUTURE_LOCATOR",
  };
  const root = { innerHTML: "" };
  paintShell(root, adapterFor(snapshot), `#/comercial/atividade?resource=${DEAL_ID}`);

  const reading = readingTextOf(root.innerHTML);
  assert.match(reading, /Sistema de origem · leitura operacional/);
  assert.match(reading, /Sistema de origem · atividade comercial/);
  assert.match(reading, /Sistema de origem · exceção comercial/);
  for (const raw of [
    "FUTURE_SOURCE_SYSTEM",
    "FUTURE_SOURCE_KIND",
    "FUTURE_LOCATOR",
    "FUTURE_ACTIVITY_SOURCE",
    "FUTURE_HISTORY_SOURCE",
  ]) {
    assert.doesNotMatch(reading, new RegExp(raw));
    assert.match(root.innerHTML, new RegExp(raw));
  }
});

test("lead detail treats inherited property names as unknown provenance and history sources", () => {
  for (const poisoned of ["constructor", "toString", "__proto__"]) {
    const operations = representativeOperations();
    for (const row of operations.activity as Record<string, unknown>[]) row.source = poisoned;
    for (const row of operations.exceptions as Record<string, unknown>[]) row.source = poisoned;
    const snapshot = snapshotWith(operations);
    snapshot.provenance.source = {
      system: poisoned,
      kind: poisoned,
      locator: `locator:${poisoned}`,
    };
    const root = { innerHTML: "" };

    assert.doesNotThrow(() => {
      paintShell(root, adapterFor(snapshot), `#/comercial/atividade?resource=${DEAL_ID}`);
    });
    const reading = readingTextOf(root.innerHTML);
    assert.match(reading, /Sistema de origem · leitura operacional/);
    assert.match(reading, /Sistema de origem · atividade comercial/);
    assert.match(reading, /Sistema de origem · exceção comercial/);
    assert.doesNotMatch(reading, new RegExp(`(?:locator:)?${poisoned}`));
    assert.match(root.innerHTML, new RegExp(`locator:${poisoned}`));
    assert.match(root.innerHTML, new RegExp(`data-history-source="${poisoned}"`));
  }
});

test("an unnamed item is titled honestly and its handle only exists in the technical block", () => {
  const snapshot = snapshotWith(representativeOperations());
  const model = leadDetailView({ snapshot, resource: OPAQUE });
  assert.equal(model.found, true);
  assert.equal(model.titleFromOrigin, false);
  assert.equal(model.title, "Organização não identificada pela origem");
  assert.ok(model.technicalIds.some((row) => row.value === OPAQUE));

  const html = leadDetailBlock({ snapshot, resource: OPAQUE });
  assert.match(html, /data-technical-detail="ids"/);
  const visible = visibleTextOf(html);
  assert.equal(
    /6f2c1f7a-6b4e-4a1e-9c3d-2f7b8a5e1c44/.test(visible),
    false,
    "no UUID may be readable outside the collapsed technical detail",
  );
  assert.equal(/warmbly:action:/.test(visible), false);
  assert.match(html, /6f2c1f7a-6b4e-4a1e-9c3d-2f7b8a5e1c44/, "but the handle is still available to copy");
  assert.match(html, /name="copy_payload"/);
});

test("local records and Warmbly writes are two separate, separately labelled groups", () => {
  const html = leadDetailBlock({ snapshot: snapshotWith(representativeOperations()), resource: DEAL_ID });
  assert.match(html, /data-action-scope="control-center-only"/);
  assert.match(html, /data-action-scope="warmbly-write"/);
  assert.match(html, /não gravam no Warmbly/);

  const localForms = [...html.matchAll(/data-operator-form="([A-Z_]+)"/g)].map((m) => m[1]);
  assert.ok(localForms.length >= 4);
  for (const kind of localForms) {
    assert.ok(
      [
        "REVIEW_ACTIVITY",
        "ACKNOWLEDGE_EXCEPTION",
        "REOPEN_EXCEPTION",
        "CONFIRM_NEXT_ACTION",
        "REJECT_NEXT_ACTION",
        "RECORD_NOTE",
        "MARK_REVIEWED",
      ].includes(kind ?? ""),
      `${kind} is not an accepted operator action type`,
    );
  }
  // Every local form declares where it writes, and it is never Warmbly.
  const localScoped = [...html.matchAll(/data-operator-form="[A-Z_]+"[^>]* data-writes-to="([a-z-]+)"/g)].map(
    (m) => m[1],
  );
  assert.equal(localScoped.length, localForms.length);
  assert.deepEqual([...new Set(localScoped)], ["control-center"]);

  const upstream = [...html.matchAll(/data-warmbly-dispatch="([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(upstream, ["acknowledge"], "acknowledge is the only lead-scoped Warmbly write");
  assert.match(html, /data-warmbly-dispatch="acknowledge" data-writes-to="warmbly"/);

  for (const forbidden of ["send", "send_email", "send_whatsapp", "dispatch_now", "enroll", "charge"]) {
    assert.equal(
      new RegExp(`data-(operator-form|warmbly-dispatch)="${forbidden}"`, "i").test(html),
      false,
      `${forbidden} must have no control on this surface`,
    );
  }
  // Dispatch-wide controls belong to the outbound cockpit, not to one lead.
  assert.equal(/data-warmbly-dispatch="(pause|resume)"/.test(html), false);
});

test("a deal that is not an inbound alert is offered no Warmbly write at all", () => {
  const ops = representativeOperations();
  // Drop the alert that made this deal eligible; only the pipeline row remains.
  ops.exceptions = (ops.exceptions as Record<string, unknown>[]).filter(
    (row) => row.source_id !== DEAL_ID,
  );
  const model = leadDetailView({ snapshot: snapshotWith(ops), resource: DEAL_ID });
  assert.equal(model.warmblyTargetId, null);
  assert.equal(model.warmblyRefusalReason, "not-an-alert");
  const html = leadDetailBlock({ snapshot: snapshotWith(ops), resource: DEAL_ID });
  assert.equal(/data-warmbly-dispatch=/.test(html), false);
  assert.match(html, /data-warmbly-refusal="not-an-alert"/);
  assert.match(html, /só reconhece alertas de inbound/);
  assert.match(html, /data-operator-form="CONFIRM_NEXT_ACTION"/, "local records still apply");
});

test("a common commercial exception with a valid target id cannot authorize an inbound acknowledge", () => {
  const ops = representativeOperations();
  const exceptions = ops.exceptions as Record<string, unknown>[];
  ops.exceptions = exceptions
    .filter((row) => row.source !== "warmbly.attention")
    .map((row) => ({ ...row, source_id: DEAL_ID }));
  const model = leadDetailView({ snapshot: snapshotWith(ops), resource: DEAL_ID });
  assert.equal(model.warmblyTargetId, null);
  assert.equal(model.warmblyRefusalReason, "not-an-alert");
  const html = leadDetailBlock({ snapshot: snapshotWith(ops), resource: DEAL_ID });
  assert.equal(/data-warmbly-dispatch=/.test(html), false);
});

test("Warmbly acknowledge targets the proven inbound lead, never the exception, source or opened resource", () => {
  const openedResource = "opened_alias_42";
  const exceptionId = "exception_record_42";
  const sourceId = "attention_source_42";
  const leadId = "lead_proven_42";
  const ops = representativeOperations();
  ops.activity = [{
    source_id: openedResource,
    lead_or_account: "Conta comprovada",
    event: "inbound_unread",
    state: "open",
  }];
  ops.pipeline = [];
  ops.exceptions = [{
    id: exceptionId,
    source_id: sourceId,
    target_id: openedResource,
    canonical_id: "cc:attention-item:exception-record-42",
    kind: "inbound_unread",
    source: "warmbly.attention",
    status: "open",
    why: "inbound aguarda leitura",
    evidence: {
      entity_ref: { type: "inbound_lead", id: leadId },
      lead_id: leadId,
    },
  }];

  const model = leadDetailView({ snapshot: snapshotWith(ops), resource: openedResource });
  assert.notEqual(exceptionId, sourceId);
  assert.notEqual(sourceId, openedResource);
  assert.equal(model.warmblyTargetId, leadId);
  const html = leadDetailBlock({ snapshot: snapshotWith(ops), resource: openedResource });
  assert.match(html, new RegExp(`name="target_id" value="${leadId}"`));
  assert.equal(html.includes(`name="target_id" value="${exceptionId}"`), false);
  assert.equal(html.includes(`name="target_id" value="${sourceId}"`), false);
  assert.equal(html.includes(`name="target_id" value="${openedResource}"`), false);
});

test("conflicting explicit lead ids fail closed instead of choosing a preferred field", () => {
  const ops = representativeOperations();
  ops.activity = [{ source_id: "opened_ambiguous", event: "inbound_unread", state: "open" }];
  ops.pipeline = [];
  ops.exceptions = [{
    id: "exception_ambiguous",
    target_id: "opened_ambiguous",
    source_id: "exception_source",
    kind: "inbound_unread",
    source: "warmbly.attention",
    status: "open",
    evidence: {
      entity_ref: { type: "inbound_lead", id: "lead_A" },
      lead_id: "lead_B",
    },
  }];
  const model = leadDetailView({ snapshot: snapshotWith(ops), resource: "opened_ambiguous" });
  assert.equal(model.warmblyTargetId, null);
  assert.equal(model.warmblyRefusalReason, "lead-id-unproven");
});

test("an inbound exception without proven lead identity fails closed even when source_id looks valid", () => {
  const ops = representativeOperations();
  ops.activity = [{ source_id: "opened_record", event: "inbound_unread", state: "open" }];
  ops.pipeline = [];
  ops.exceptions = [{
    id: "exception_42",
    source_id: "plausible_lead_42",
    target_id: "opened_record",
    kind: "inbound_unread",
    source: "warmbly.attention",
    status: "open",
    evidence: { code: "inbound_unread" },
  }];
  const model = leadDetailView({ snapshot: snapshotWith(ops), resource: "opened_record" });
  assert.equal(model.warmblyTargetId, null);
  assert.equal(model.warmblyRefusalReason, "lead-id-unproven");
  const html = leadDetailBlock({ snapshot: snapshotWith(ops), resource: "opened_record" });
  assert.equal(/data-warmbly-dispatch=/.test(html), false);
  assert.match(html, /data-warmbly-refusal="lead-id-unproven"/);
});

test("confirmation is proportional to consequence without duplicating the human decision", () => {
  const html = leadDetailBlock({ snapshot: snapshotWith(representativeOperations()), resource: DEAL_ID });
  const formFor = (attr: string, value: string): string => {
    const start = html.indexOf(`${attr}="${value}"`);
    assert.notEqual(start, -1, `${value} form is missing`);
    const open = html.lastIndexOf("<form", start);
    const close = html.indexOf("</form>", start);
    return html.slice(open, close);
  };

  const low = formFor("data-operator-form", "RECORD_NOTE");
  assert.match(low, /data-action-risk="baixo"/);
  assert.match(low, /name="note" required/);
  assert.equal(/name="ciencia"/.test(low), false, "a low-risk local note needs no extra gate");

  const medium = formFor("data-operator-form", "REJECT_NEXT_ACTION");
  assert.match(medium, /data-action-risk="medio"/);
  assert.match(medium, /Motivo operacional/);
  assert.match(medium, /name="note" required/);
  assert.equal(/name="ciencia"|pattern="RECONHECER"/.test(medium), false);

  const high = formFor("data-warmbly-dispatch", "acknowledge");
  assert.match(high, /data-action-risk="medio"/);
  assert.match(high, /data-one-decision="true"/);
  assert.match(high, /marca este alerta de inbound como visto/);
  assert.equal(/name="ciencia"|pattern="RECONHECER"|name="reason"/.test(high), false);
});

test("an id the operator channel would reject is never offered as a Warmbly write", () => {
  assert.equal(WARMBLY_TARGET_ID_PATTERN.test(OPAQUE), false);
  const ops = representativeOperations();
  ops.exceptions = (ops.exceptions as Record<string, unknown>[]).map((row) => {
    if (row.source !== "warmbly.attention") return row;
    const evidence = row.evidence as Record<string, unknown>;
    return {
      ...row,
      id: `alert_${OPAQUE}`,
      source_id: OPAQUE,
      evidence: { ...evidence, entity_ref: { type: "inbound_lead", id: OPAQUE }, lead_id: OPAQUE },
    };
  });
  const html = leadDetailBlock({ snapshot: snapshotWith(ops), resource: OPAQUE });
  assert.equal(/data-warmbly-dispatch=/.test(html), false);
  assert.match(html, /data-warmbly-refusal="target-id"/);
  assert.equal(leadDetailView({ snapshot: snapshotWith(ops), resource: OPAQUE }).warmblyRefusalReason, "target-id");
  assert.match(html, /não é um alvo válido do canal de operador/);
  // The local audit record is still available: refusing upstream is not
  // refusing the operator a way to record what they saw.
  assert.match(html, /data-operator-form="ACKNOWLEDGE_EXCEPTION"/);
});

test("an unknown resource says so instead of rendering an empty page", () => {
  const html = leadDetailBlock({
    snapshot: snapshotWith(representativeOperations()),
    resource: "deal_does_not_exist",
    query: "q=andrade",
  });
  assert.match(html, /data-lead-detail="not-found"/);
  assert.match(html, /não significa que ele não exista no Warmbly|não que ele não exista no Warmbly/);
  assert.match(html, /data-lead-back="queue"/);
  assert.equal(/data-operator-form=/.test(html), false, "no action may act on an item we cannot see");
  assert.equal(/data-warmbly-dispatch=/.test(html), false);
});

test("hostile strings from the origin are escaped", () => {
  const ops = representativeOperations();
  const pipeline = ops.pipeline as Record<string, unknown>[];
  pipeline[0]!.display_name = `<img src=x onerror="alert(1)">`;
  pipeline[0]!.next_action = `<script>alert("xss")</script>`;
  const html = leadDetailBlock({ snapshot: snapshotWith(ops), resource: DEAL_ID });
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;img/);
});

function adapterFor(snapshot: CommercialSnapshot) {
  const page: DestinationPage = {
    id: "comercial",
    label: "Comercial",
    scope: "commercial",
    generated_at: "2026-08-20T18:00:00Z",
    operator: { kind: "human", id: "human:founder" },
    headline: "Operação comercial",
    attention: [],
    priorities: [],
    commercial: snapshot,
  };
  return {
    mode: "http" as const,
    actions: ["read"] as const,
    readOperator: () => page.operator,
    readDestination: (): AdapterReadResult => ({ ok: true, loading: false, page }),
    readAttention: () => [],
    readPriorities: () => [],
  };
}

test("the route reaches the detail and the rendered back link carries the queue state", () => {
  const adapter = adapterFor(snapshotWith(representativeOperations()));
  const root = { innerHTML: "" };

  paintShell(root, adapter, "#/comercial/atividade?q=andrade&page=2");
  assert.match(root.innerHTML, /id="atividade-title"/, "no resource means the queue");
  const link = /href="([^"]*resource=[^"]*)"/.exec(root.innerHTML);
  assert.ok(link, "each queue row links into its detail");
  const href = (link[1] ?? "").replaceAll("&amp;", "&");
  assert.match(href, /q=andrade/);
  assert.match(href, /page=2/);
  assert.match(href, /pos=1/);

  paintShell(root, adapter, href);
  assert.match(root.innerHTML, /data-lead-detail="found"/);
  assert.equal(/id="atividade-title"/.test(root.innerHTML), false, "the detail replaces the queue");
  assert.match(root.innerHTML, /Metalúrgica Andrade/);
  const back = /data-lead-back="queue"/.exec(root.innerHTML);
  assert.ok(back);
  const backHref = /href="([^"]*)" data-lead-back="queue"/.exec(root.innerHTML)?.[1] ?? "";
  const backParams = new URLSearchParams(backHref.replaceAll("&amp;", "&").split("?")[1]);
  assert.equal(backParams.get("q"), "andrade");
  assert.equal(backParams.get("page"), "2");
  assert.equal(backParams.get("resource"), null);
  assert.match(root.innerHTML, /item 1 de 2/, "position follows the filtered queue, not hidden rows");
});

test("a queue row the origin gave no id is listed but not offered as a dead link", () => {
  const ops = representativeOperations();
  ops.activity = [
    { at: "2026-08-20T17:30:00Z", lead_or_account: "Sem identificador", event: "unknown", evidence: "x" },
  ];
  const adapter = adapterFor(snapshotWith(ops));
  const root = { innerHTML: "" };
  paintShell(root, adapter, "#/comercial/atividade");
  assert.match(root.innerHTML, /Sem identificador/);
  assert.equal(/data-lead-detail-link=/.test(root.innerHTML), false);
});

test("detail resolves an item beyond the preview cap from the current list page", async () => {
  const targetId = "lead_0051";
  const target = {
    at: "2026-08-20T16:00:00Z",
    lead_or_account: "Conta da página três",
    source_id: targetId,
    event: "reply",
    state: "open",
    evidence: "retornada somente pela list view corrente",
  };
  const preview = Array.from({ length: 50 }, (_, index) => ({
    ...target,
    source_id: `lead_${String(index).padStart(4, "0")}`,
    lead_or_account: `Conta preview ${index}`,
  }));
  const nestedOps = {
    activity: preview,
    overview: { activity: 75, activity_shown: 50 },
    list_views: { atividade: { view: { items: [target] } } },
  };
  const nestedModel = leadDetailView({ snapshot: snapshotWith(nestedOps), resource: targetId });
  assert.equal(nestedModel.found, true, "the internal list-view shape must participate in detail lookup");
  assert.equal(nestedModel.title, "Conta da página três");

  const snapshot = snapshotWith({ activity: preview, overview: { activity: 75, activity_shown: 50 } });
  const { fetchImpl, calls } = recordingFetch((url) => {
    const path = url.split("?")[0];
    if (path?.endsWith("/v1/domains/commercial")) return snapshot;
    if (path?.endsWith("/v1/domains/commercial/lists/activity")) {
      return {
        schema_version: "control-center.commercial-list.v1",
        list: "activity",
        generated_at: snapshot.generated_at,
        loaded_total: 75,
        declared_total: 75,
        complete: true,
        matched: 75,
        items: [target],
        page: 3,
        page_count: 3,
        page_size: 25,
        range_start: 51,
        range_end: 51,
        filtered: false,
        facet_values: { estado: ["open"], tipo: ["reply"], origem: [], responsavel: [], prioridade: [] },
        unavailable_facets: ["origem", "responsavel", "prioridade"],
        query: {
          q: "",
          facets: { estado: "all", tipo: "all", origem: "all", responsavel: "all", prioridade: "all" },
          periodo: "all",
          ordem: "urgencia",
          pagina: 3,
          porPagina: 25,
        },
      };
    }
    return undefined;
  });
  const adapter = createHttpAdapter("http://127.0.0.1:8787", fetchImpl, {
    kind: "human",
    id: "founder-local",
  });
  const root = { innerHTML: "" };
  paintShell(root, adapter, `#/comercial/atividade?pagina=3&resource=${targetId}&pos=51&of=75`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(root.innerHTML, /data-lead-detail="found"/);
  assert.match(root.innerHTML, /Conta da página três/);
  assert.match(root.innerHTML, /item 51 de 75/);
  assert.match(root.innerHTML, /Próximo passo<\/dt><dd>ausente — nenhum próximo passo informado pela origem/, "missing pipeline context stays explicit");
  assert.ok(calls.some((url) => /commercial\/lists\/activity\?.*pagina=3/.test(url)));
});

test("a paginated filtered queue consumes focus only after ready paint and never puts it in selectors or links", async () => {
  const resource = `lead:unsafe[id]\"><script>`;
  const focusToken = queueFocusToken(resource, { index: 51, total: 61 });
  const row = {
    at: "2026-08-20T17:30:00Z",
    lead_or_account: "Conta retornada",
    source_id: resource,
    event: "reply",
    state: "open",
    evidence: "resposta observada",
  };
  const operations = representativeOperations();
  operations.activity = [row];
  operations.overview = { activity: 61, activity_shown: 50 };
  operations.list_views = {
    atividade: {
      schema_version: "control-center.commercial-list.v1",
      loaded_total: 61,
      declared_total: 61,
      complete: true,
      matched: 61,
      items: [row],
      page: 3,
      page_count: 3,
      page_size: 25,
      range_start: 51,
      range_end: 51,
      filtered: true,
      facet_values: {
        estado: ["open"],
        tipo: ["reply"],
        origem: [],
        responsavel: [],
        prioridade: [],
      },
      unavailable_facets: ["origem", "responsavel", "prioridade"],
      query: {
        q: "Conta",
        facets: {
          estado: "open",
          tipo: "all",
          origem: "all",
          responsavel: "all",
          prioridade: "all",
        },
        periodo: "all",
        ordem: "recentes",
        pagina: 3,
        porPagina: 25,
      },
    },
  };

  const ready = adapterFor(snapshotWith(operations)).readDestination() as AdapterReadResult;
  const adapter = {
    ...adapterFor(snapshotWith(operations)),
    readDestination: async (): Promise<AdapterReadResult> => ready,
  };
  let html = "";
  let focusCalls = 0;
  let scrollCalls = 0;
  const selectors: string[] = [];
  const target = {
    addEventListener(): void {},
    getAttribute(name: string): string | null {
      if (name === "id") return queueFocusDomId(focusToken);
      if (name === "data-queue-focus") return focusToken;
      return null;
    },
    querySelector(): { value: string } | null {
      return null;
    },
    focus(options?: { preventScroll?: boolean }): void {
      assert.deepEqual(options, { preventScroll: true });
      focusCalls += 1;
    },
    scrollIntoView(options?: { block?: "center"; inline?: "nearest" }): void {
      assert.deepEqual(options, { block: "center", inline: "nearest" });
      scrollCalls += 1;
    },
  };
  const root = {
    get innerHTML(): string {
      return html;
    },
    set innerHTML(next: string) {
      html = next;
    },
    querySelectorAll(selector: string): typeof target[] {
      selectors.push(selector);
      return selector === "[data-queue-focus]" && html.includes(queueFocusDomId(focusToken))
        ? [target]
        : [];
    },
  };
  const initial = `#/comercial/atividade?q=Conta&estado=open&ordem=recentes&pagina=3&por_pagina=25&focus=${focusToken}`;
  const runtime = createMemoryRuntime(initial);
  const handle = mount(root, adapter, runtime);
  try {
    assert.equal(focusCalls, 0, "the loading paint must not consume focus");
    assert.match(runtime.getHash(), /focus=/, "loading must leave the marker for the ready paint");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(focusCalls, 1);
    assert.equal(scrollCalls, 1);
    assert.ok(selectors.includes("[data-queue-focus]"));
    assert.equal(selectors.some((selector) => selector.includes(resource)), false);
    assert.match(html, new RegExp(`id="${queueFocusDomId(focusToken)}" data-queue-focus="${focusToken}" tabindex="-1"`));
    assert.match(html, /pos=51&amp;of=61/, "remote page position must reach beyond the preview cap");
    assert.equal(/href="[^"]*focus=/.test(html), false, "pagination/detail links are rendered from the cleaned hash");

    const consumed = new URLSearchParams(runtime.getHash().split("?")[1]);
    assert.equal(consumed.get("focus"), null);
    assert.equal(consumed.get("q"), "Conta");
    assert.equal(consumed.get("estado"), "open");
    assert.equal(consumed.get("ordem"), "recentes");
    assert.equal(consumed.get("pagina"), "3");
    assert.equal(consumed.get("por_pagina"), "25");

    runtime.setHash("#/comercial/atividade?q=Outra&estado=open&pagina=2&por_pagina=25");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(focusCalls, 1, "a later filter/page paint must not refocus the old row");
  } finally {
    handle.unmount();
  }
});

test("row focus tokens disambiguate duplicate source ids and stay bounded under hostile input", () => {
  const repeated = "same_source_id";
  const firstToken = queueFocusToken(repeated, { index: 1, total: 2 });
  const secondToken = queueFocusToken(repeated, { index: 2, total: 2 });
  assert.notEqual(firstToken, secondToken);

  let firstFocused = 0;
  let secondFocused = 0;
  let fallbackFocused = 0;
  const candidate = (token: string, onFocus: () => void) => ({
    addEventListener(): void {},
    getAttribute(name: string): string | null {
      if (name === "id") return queueFocusDomId(token);
      if (name === "data-queue-focus") return token;
      return null;
    },
    querySelector(): { value: string } | null { return null; },
    focus(): void { onFocus(); },
    scrollIntoView(): void {},
  });
  const first = candidate(firstToken, () => { firstFocused += 1; });
  const second = candidate(secondToken, () => { secondFocused += 1; });
  const fallback = candidate("fallback", () => { fallbackFocused += 1; });
  const selectors: string[] = [];
  const root = {
    innerHTML: "",
    querySelectorAll(selector: string) {
      selectors.push(selector);
      if (selector === "[data-queue-focus]") return [first, second];
      if (selector === "[data-list-count]") return [fallback];
      return [];
    },
  };
  let replaced = "";
  const focused = consumeQueueFocus(
    root,
    `#/comercial/atividade?pagina=1&focus=${secondToken}`,
    true,
    (next) => { replaced = next; },
  );
  assert.equal(focused, true);
  assert.equal(firstFocused, 0);
  assert.equal(secondFocused, 1);
  assert.equal(replaced, "#/comercial/atividade?pagina=1");

  const hostile = "x".repeat(100_000);
  const bounded = queueFocusToken(hostile, { index: 999_999_999, total: 999_999_999 });
  assert.ok(bounded.length < 64);
  assert.ok(queueFocusDomId(bounded).length < 64);
  selectors.length = 0;
  consumeQueueFocus(
    root,
    `#/comercial/atividade?q=mantido&focus=${hostile}`,
    true,
    (next) => { replaced = next; },
  );
  assert.equal(replaced, "#/comercial/atividade?q=mantido");
  assert.equal(selectors.includes("[data-queue-focus]"), false, "invalid huge markers are not scanned against rows");
  assert.equal(fallbackFocused, 1, "a missing/invalid target moves focus to list status");

  const drifted = queueFocusToken("row_that_disappeared", { index: 3, total: 3 });
  consumeQueueFocus(
    root,
    `#/comercial/atividade?pagina=2&focus=${drifted}`,
    true,
    (next) => { replaced = next; },
  );
  assert.equal(replaced, "#/comercial/atividade?pagina=2");
  assert.equal(fallbackFocused, 2, "a valid marker whose row drifted away also focuses list status");
});
