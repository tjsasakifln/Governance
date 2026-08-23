/**
 * End-to-end convergence for the lead/opportunity detail (issue #66).
 *
 * Nothing here is stubbed at the seam that matters. A raw Warmbly collector
 * payload goes through the real projector, is stored as the real operational
 * snapshot row, is served by the real context service over a real socket, is
 * read back by the real web-shell HTTP adapter, and is painted by the real
 * shell. Every assertion is on the HTML an operator would see.
 *
 * The wave-1 review found three PRs whose unit tests passed against a shape
 * production never emits. This file exists so that cannot happen to this one:
 * the `operations.activity` rows it asserts on are the ones
 * `operationsFromWarmbly` actually builds, not a hand-written echo of them.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createHttpAdapter } from "../../apps/web-shell/src/adapters/http.ts";
import { paintShell } from "../../apps/web-shell/src/app.ts";
import {
  leadDetailView,
  queueFocusToken,
  WARMBLY_TARGET_ID_PATTERN,
} from "../../apps/web-shell/src/ui/lead-detail.ts";
import { TARGET_ID_PATTERN } from "../../connectors/warmbly/src/operator/actions.ts";
import { collectFromWarmblyPayload } from "../../connectors/warmbly/src/mapper/normalize.ts";
import { projectCommercial } from "../../connectors/runner/src/projectors/commercial.ts";
import { projectCollector } from "../../connectors/runner/src/projectors/project.ts";
import { validateOperationalEnvelope } from "../../contracts/src/operational-envelope.ts";
import { frozenClock } from "../../services/context/src/clock.ts";
import { createRequestListener } from "../../services/context/src/http.ts";
import { silentLogger } from "../../services/context/src/log.ts";
import { createFixtureOperationalPort } from "../../services/context/src/operational/fixture.ts";
import { createOperationalService } from "../../services/context/src/operational/service.ts";
import type { OperationalSnapshotRow } from "../../services/context/src/operational/types.ts";
import { REPRESENTATIVE_REPO_DOMAINS } from "../../services/context/src/representative.ts";
import { FOUNDER, NOW, makeService } from "../../services/context/test/helpers.ts";

const here = dirname(fileURLToPath(import.meta.url));

const OBSERVED_AT = "2026-08-20T11:50:00.000Z";
const ALERT_UUID = "6f2c1f7a-6b4e-4a1e-9c3d-2f7b8a5e1c44";
/** The shape the issue reports on screen. */
const OPAQUE_ALERT_ID = `warmbly:action:${ALERT_UUID}:next_action`;
const DEAL_UUID = "b31c9e02-4f77-4a2a-9d51-8ac0f0d0a771";

/** A raw Warmbly collector payload, as the connector hands it to the runner. */
function warmblyPayload(): Record<string, unknown> {
  return {
    counts: { deals_open: 2, inbound_now: 1, tasks_overdue: 1 },
    deals: [
      {
        id: DEAL_UUID,
        company: "Metalúrgica Andrade",
        stage_name: "Proposta",
        status: "OPEN",
        next_action: "confirmar escopo com o engenheiro",
        value: { amount_cents: 4800000, currency: "BRL" },
        updated_at: "2026-08-20T11:30:00.000Z",
      },
    ],
    tasks: [
      {
        id: `task_${DEAL_UUID}`,
        lead_id: DEAL_UUID,
        company: "Metalúrgica Andrade",
        kind: "call_back",
        status: "overdue",
        title: "retomar contato após proposta",
        updated_at: "2026-08-20T10:00:00.000Z",
      },
    ],
    attention: [
      {
        // No company, no name: `displayName` falls back to this id, which is
        // exactly why the queue today headlines a handle.
        id: OPAQUE_ALERT_ID,
        kind: "inbound_unread",
        status: "open",
        why: "inbound sem leitura há 2 dias",
        next_action: "ler e responder no Warmbly",
        entity_ref: { type: "inbound_lead", id: DEAL_UUID },
        at: "2026-08-20T11:00:00.000Z",
      },
    ],
    confenge_status: { auto_send_enabled: false },
  };
}

function projectedRow(): OperationalSnapshotRow {
  const projected = projectCommercial({
    collector: "warmbly-commercial",
    freshness_status: "FRESH",
    observed_at: OBSERVED_AT,
    source: { system: "warmbly", kind: "crm-read-model", locator: "commercial/pipeline" },
    confidence: 0.84,
    payload: warmblyPayload(),
  });
  return {
    id: "cc:operational-snapshot:commercial-company",
    scope: projected.scope,
    snapshot_kind: projected.snapshot_kind,
    generated_at: OBSERVED_AT,
    source: projected.source,
    observed_at: projected.observed_at,
    freshness_status: projected.freshness_status,
    confidence: projected.confidence,
    payload: projected.payload,
  };
}

async function withRows(
  rows: OperationalSnapshotRow[],
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const { service } = makeService();
  const operational = createOperationalService({
    port: createFixtureOperationalPort({ operational_snapshots: rows }),
    clock: frozenClock(NOW),
    founderActorId: FOUNDER.id,
    repoDomains: REPRESENTATIVE_REPO_DOMAINS,
  });
  const server = createServer(createRequestListener({ service, operational, logger: silentLogger }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  return withRows([projectedRow()], fn);
}

async function paint(base: string, hash: string): Promise<string> {
  const adapter = createHttpAdapter(base, undefined, { kind: "human", id: FOUNDER.id });
  const root = { innerHTML: "" };
  paintShell(root, adapter, hash);
  // The HTTP adapter resolves asynchronously; the shell paints a loading frame
  // first and the real frame after. Wait for the real one.
  for (let i = 0; i < 50 && !root.innerHTML.includes('data-view-state="ready"'); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return root.innerHTML;
}

/** Text an operator can actually read, minus the collapsed technical block. */
function visibleTextOf(html: string): string {
  return html
    .replace(/<details class="lead-technical"[\s\S]*?<\/details>/g, "")
    .replace(/<[^>]*>/g, " ");
}

test("the web shell's Warmbly target pattern is the connector's, not a lookalike", () => {
  assert.equal(
    WARMBLY_TARGET_ID_PATTERN.source,
    TARGET_ID_PATTERN.source,
    "a drifted copy would offer upstream writes the channel refuses",
  );
  assert.equal(WARMBLY_TARGET_ID_PATTERN.flags, TARGET_ID_PATTERN.flags);
});

test("the real normalizer/projector preserves a proven inbound lead id for acknowledge", () => {
  const leadId = "lead_from_real_normalizer_42";
  const normalized = collectFromWarmblyPayload(
    {
      confenge_inbound: [{
        lead_id: leadId,
        company: "Conta Normalizada",
        status: "new",
        why_now: "inbound aguarda leitura",
        recommended_action: "revisar inbound",
      }],
    },
    { now: new Date(OBSERVED_AT) },
  );
  const projected = projectCommercial({
    collector: "warmbly-commercial",
    freshness_status: "FRESH",
    observed_at: OBSERVED_AT,
    source: { system: "warmbly", kind: "crm-read-model", locator: "commercial/pipeline" },
    confidence: 0.84,
    payload: normalized as unknown as Record<string, unknown>,
  });
  const operations = projected.payload.operations as Record<string, unknown>;
  const exception = (operations.exceptions as Record<string, unknown>[]).find(
    (row) => row.source === "warmbly.attention" && row.kind === "inbound_lead",
  );
  assert.ok(exception);
  const evidence = exception.evidence as Record<string, unknown>;
  assert.deepEqual(evidence.entity_ref, { type: "inbound_lead", id: leadId });
  const model = leadDetailView({
    snapshot: {
      schema_version: "control-center.commercial-snapshot.v1",
      id: "cc:commercial-snapshot:normalized-inbound",
      scope: "commercial",
      generated_at: OBSERVED_AT,
      provenance: {
        source: projected.source,
        observed_at: projected.observed_at,
        freshness_status: projected.freshness_status,
        confidence: projected.confidence,
      },
      authority: {
        catalog_authority: "governance",
        commercial_runtime: "warmbly",
        this_document: "read_model",
      },
      operations,
    } as never,
    resource: String(exception.id),
  });
  assert.equal(model.warmblyTargetId, leadId);
});

test("clicking inbound activity 51 carries the compact operator target through Context HTTP", async () => {
  const inbound = Array.from({ length: 51 }, (_, index) => ({
    lead_id: `lead-${String(index).padStart(3, "0")}`,
    company: `Conta inbound ${index}`,
    status: "new",
    why_now: `inbound ${index} aguarda humano`,
    recommended_action: "revisar inbound",
  }));
  const normalized = collectFromWarmblyPayload(
    { confenge_inbound: inbound },
    { now: new Date(OBSERVED_AT) },
  );
  const projected = projectCollector({
    collector: "warmbly",
    freshness_status: "FRESH",
    observed_at: OBSERVED_AT,
    source: { system: "warmbly", kind: "crm-read-model", locator: "commercial/pipeline" },
    confidence: 0.9,
    payload: normalized,
  });
  const rows: OperationalSnapshotRow[] = projected.map((snapshot, index) => ({
    id: `cc:operational-snapshot:inbound-51-${index}`,
    scope: snapshot.scope,
    snapshot_kind: snapshot.snapshot_kind,
    generated_at: snapshot.observed_at,
    source: snapshot.source,
    observed_at: snapshot.observed_at,
    freshness_status: snapshot.freshness_status,
    confidence: snapshot.confidence,
    payload: snapshot.payload,
  }));

  await withRows(rows, async (base) => {
    const auth = {
      "x-actor-id": FOUNDER.id,
      "x-actor-kind": FOUNDER.kind,
    };
    const exceptionResponse = await fetch(
      `${base}/v1/domains/commercial/lists/exceptions?scope=commercial&tipo=inbound_lead&ordem=identificador&pagina=3`,
      { headers: auth },
    );
    assert.equal(exceptionResponse.status, 200);
    const exceptionPage = await exceptionResponse.json() as Record<string, unknown>;
    const exception51 = (exceptionPage.items as Record<string, unknown>[])[0];
    assert.equal(exception51?.lead_id, "lead-050");
    assert.equal("evidence" in (exception51 ?? {}), false, "compact exception must not expose broad evidence");

    const rawInboundResponse = await fetch(
      `${base}/v1/domains/commercial/lists/activity?scope=commercial&tipo=new&ordem=identificador`,
      { headers: auth },
    );
    const rawInboundPage = await rawInboundResponse.json() as Record<string, unknown>;
    assert.ok(
      (rawInboundPage.items as Record<string, unknown>[]).every(
        (row) => row.operator_target_id === undefined && row.operator_target_kind === undefined,
      ),
      "ordinary inbound collection rows are not operator alerts",
    );

    const queue = await paint(
      base,
      "#/comercial/atividade?tipo=inbound_lead&ordem=identificador&pagina=3",
    );
    const href = /href="([^"]*resource=[^"]*)" data-lead-detail-link=/.exec(queue)?.[1]
      ?.replaceAll("&amp;", "&") ?? "";
    assert.match(href, /pos=51&of=51/, "the real page-three row must be the clicked occurrence");
    const detail = await paint(base, href);
    assert.match(detail, /data-lead-detail="found"/);
    assert.match(detail, /name="target_id" value="lead-050"/);
    assert.equal(/data-warmbly-refusal=/.test(detail), false);
  });
});

test("the projector really does headline an opaque handle — this is the defect being fixed", () => {
  const payload = projectedRow().payload;
  const operations = payload.operations as Record<string, unknown>;
  const activity = operations.activity as Record<string, unknown>[];
  const fromAlert = activity.find((row) => row.source_id === OPAQUE_ALERT_ID);
  assert.ok(fromAlert, "the attention row is projected into the activity queue");
  assert.equal(
    fromAlert.lead_or_account,
    OPAQUE_ALERT_ID,
    "production puts the raw id where a company name belongs",
  );
});

test("a lead detail served end-to-end shows context and keeps handles out of the reading", async () => {
  await withServer(async (base) => {
    const envelope = await fetch(`${base}/v1/operational-snapshots?scope=company`, {
      headers: { "x-actor-id": FOUNDER.id, "x-actor-kind": FOUNDER.kind, accept: "application/json" },
    });
    assert.equal(envelope.status, 200);
    const live = validateOperationalEnvelope(await envelope.json());
    assert.equal(live.ok, true, live.errors.map((e) => e.message).join("; "));

    const html = await paint(base, `#/comercial/atividade?q=andrade&page=2&resource=${DEAL_UUID}&pos=2&of=3`);
    assert.match(html, /data-lead-detail="found"/);
    assert.match(html, /Metalúrgica Andrade/);
    assert.match(html, /Proposta/);
    assert.match(html, /confirmar escopo com o engenheiro/);
    assert.match(html, /BRL 48\.000,00/);
    // Owner is not projected by the commercial read model. The field is shown
    // as absent with the reason, never as an invented name and never as blank.
    assert.match(html, /Respons[áa]vel/);
    assert.match(html, /não informado pela origem/);

    const visible = visibleTextOf(html);
    assert.equal(new RegExp(DEAL_UUID).test(visible), false, "the deal uuid is not in the reading");
    assert.match(html, new RegExp(DEAL_UUID), "but it is in the copyable technical block");
    assert.match(html, /name="copy_payload"/);

    const back = /href="([^"]*)" data-lead-back="queue"/.exec(html)?.[1] ?? "";
    const backParams = new URLSearchParams(back.replaceAll("&amp;", "&").split("?")[1]);
    assert.equal(backParams.get("q"), "andrade", "the queue filter survives the round trip");
    assert.equal(backParams.get("page"), "2");
    assert.equal(backParams.get("resource"), null);
    assert.equal(backParams.get("focus"), queueFocusToken(DEAL_UUID, { index: 2, total: 3 }));
  });
});

test("the two write mechanisms stay separate on a real payload", async () => {
  await withServer(async (base) => {
    const html = await paint(base, `#/comercial/atividade?resource=${DEAL_UUID}`);
    assert.match(html, /data-action-scope="control-center-only"/);
    assert.match(html, /data-action-scope="warmbly-write"/);
    assert.match(html, /Registros no Control Center \(não gravam no Warmbly\)/);

    const local = [...html.matchAll(/data-operator-form="([A-Z_]+)"/g)].map((m) => m[1]);
    assert.ok(local.length > 0);
    // Exactly the enum the Context Service accepts on POST /v1/operator-actions.
    const accepted = new Set([
      "REVIEW_ACTIVITY",
      "ACKNOWLEDGE_EXCEPTION",
      "REOPEN_EXCEPTION",
      "CONFIRM_NEXT_ACTION",
      "REJECT_NEXT_ACTION",
      "RECORD_NOTE",
      "MARK_REVIEWED",
    ]);
    for (const kind of local) assert.ok(accepted.has(kind ?? ""), `${kind} is not an operator action type`);
    for (const kind of local) {
      assert.match(
        html,
        new RegExp(`data-operator-form="${kind}" data-writes-to="control-center"`),
        `${kind} must declare that it does not reach Warmbly`,
      );
    }

    // The associated inbound exception proves exactly one lead-scoped target.
    assert.match(html, /data-warmbly-dispatch="acknowledge"/);
    assert.match(html, new RegExp(`name="target_id" value="${DEAL_UUID}"`));

    for (const forbidden of ["send", "send_email", "send_whatsapp", "dispatch_now", "enroll", "charge"]) {
      assert.equal(
        new RegExp(`data-(operator-form|warmbly-dispatch)="${forbidden}"`, "i").test(html),
        false,
        `${forbidden} must never have a control here`,
      );
    }
  });
});

test("a composite alert id never replaces its distinct proven lead target", async () => {
  await withServer(async (base) => {
    const html = await paint(
      base,
      `#/comercial/atividade?resource=${encodeURIComponent(OPAQUE_ALERT_ID)}`,
    );
    assert.match(html, /data-lead-detail="found"/);
    assert.match(html, /data-lead-named="false"/);
    assert.match(html, /Organização não identificada pela origem/);
    assert.equal(WARMBLY_TARGET_ID_PATTERN.test(OPAQUE_ALERT_ID), false);
    assert.match(html, /data-warmbly-dispatch="acknowledge"/);
    assert.match(html, new RegExp(`name="target_id" value="${DEAL_UUID}"`));
    assert.equal(html.includes(`name="target_id" value="${OPAQUE_ALERT_ID}"`), false);
    // Local recording is still available; refusing upstream is not refusing
    // the operator a way to write down what they saw.
    assert.match(html, /data-operator-form="ACKNOWLEDGE_EXCEPTION"/);

    const visible = visibleTextOf(html);
    assert.equal(new RegExp(ALERT_UUID).test(visible), false);
    assert.equal(/warmbly:action:/.test(visible), false);
    assert.match(html, new RegExp(ALERT_UUID));
  });
});

test("the queue still lists items and every row links into its detail", async () => {
  await withServer(async (base) => {
    // Use non-narrowing queue state here: `q=andrade` now correctly filters the
    // integrated #81 list and therefore cannot also prove that every row links.
    const html = await paint(base, "#/comercial/atividade?ordem=recentes");
    assert.match(html, /id="atividade-title"/);
    const links = [...html.matchAll(/data-lead-detail-link="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(links.length >= 2, `expected several queue rows, got ${links.length}`);
    assert.ok(links.includes(DEAL_UUID));
    assert.ok(links.some((id) => id?.includes("warmbly:action:") || id?.includes("warmbly%3Aaction")));
    const hrefs = [...html.matchAll(/href="([^"]*resource=[^"]*)"/g)].map((m) =>
      (m[1] ?? "").replaceAll("&amp;", "&"),
    );
    for (const href of hrefs) {
      assert.match(href, /ordem=recentes/, "the row link must carry the queue sort");
      assert.match(href, /pos=\d+&of=\d+/, "and the queue position");
    }
    // A row the origin did not name must not headline its handle.
    assert.equal(/warmbly:action:[^"]*<\/a>/.test(html), false);
  });
});

test("the surface is registered in the integration runner", () => {
  const runner = readFileSync(join(here, "../../scripts/integration.mjs"), "utf8");
  assert.match(runner, /tests\/convergence\/lead-detail-surface\.test\.ts/);
});
