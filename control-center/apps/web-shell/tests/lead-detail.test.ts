import assert from "node:assert/strict";
import { test } from "node:test";
import { paintShell } from "../src/app";
import type { AdapterReadResult, DestinationPage } from "../src/adapters/contract";
import type { CommercialSnapshot } from "../src/types";
import {
  WARMBLY_TARGET_ID_PATTERN,
  isOpaqueIdentifier,
  leadDetailBlock,
  leadDetailHash,
  leadDetailView,
  leadTitleOf,
  queueBackHash,
} from "../src/ui/lead-detail";

const OPAQUE = "warmbly:action:6f2c1f7a-6b4e-4a1e-9c3d-2f7b8a5e1c44:next_action";
const DEAL_ID = "deal_7cGh-42";

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
        evidence: { code: "inbound_unread" },
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
  assert.equal(backParams.get("focus"), DEAL_ID, "the queue needs the row to restore");

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
  assert.match(byLabel.get("Origem")?.value ?? "", /warmbly/);
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
  const localScoped = [...html.matchAll(/data-operator-form="[A-Z_]+" data-writes-to="([a-z-]+)"/g)].map(
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

test("confirmation is proportional to risk and enforced by the form, not by copy", () => {
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
  assert.match(medium, /<input type="checkbox" name="ciencia" required \/>/);
  assert.match(medium, /registro local/);
  assert.equal(/pattern="RECONHECER"/.test(medium), false);

  const high = formFor("data-warmbly-dispatch", "acknowledge");
  assert.match(high, /data-action-risk="alto"/);
  assert.match(high, /<input type="checkbox" name="ciencia" required \/>/);
  assert.match(high, /Entendo que esta ação grava no Warmbly/);
  assert.match(high, /pattern="RECONHECER"/);
  assert.match(high, /name="reason" required/);
});

test("an id the operator channel would reject is never offered as a Warmbly write", () => {
  assert.equal(WARMBLY_TARGET_ID_PATTERN.test(OPAQUE), false);
  const html = leadDetailBlock({ snapshot: snapshotWith(representativeOperations()), resource: OPAQUE });
  assert.equal(/data-warmbly-dispatch=/.test(html), false);
  assert.match(html, /data-warmbly-refusal="target-id"/);
  assert.equal(leadDetailView({ snapshot: snapshotWith(representativeOperations()), resource: OPAQUE }).warmblyRefusalReason, "target-id");
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
  assert.match(root.innerHTML, /item 1 de 3/);
});
