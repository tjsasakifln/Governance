import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { HttpControlCenterAdapter } from "../src/adapters/http";
import type { AdapterWriteResult, ControlCenterReadAdapter } from "../src/adapters/contract";
import { createMockAdapter } from "../src/adapters/index";
import { WARMBLY_DISPATCH_PATHS, readPathsFor } from "../src/adapters/paths";
import { createMemoryRuntime, mount, paintShell } from "../src/app";
import { DESTINATION_IDS, WARMBLY_SURFACES, getDestination } from "../src/destinations";
import {
  OUT_OF_BAND_PAUSE_FALLBACK,
  classifyDispatchOutcome,
  resolveWarmblySurface,
  type DispatchOutcomeKind,
} from "../src/ui/warmbly";
import { hasMutationControls } from "../src/ui/render";
import {
  armPendingResumeConfirmation,
  clearPendingResumeConfirmation,
  resumeObservationFingerprint,
} from "../src/warmbly-confirmation";
import { jsonResponse, operationalRouter } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Responses recorded from the real `services/context` server with the real
 * operator channel mounted. `services/context/test/warmbly-operator-wire-shapes.test.ts`
 * re-drives that server and fails if these drift, so replaying them here is a
 * replay of observed traffic rather than a stub of an imagined body.
 */
interface RecordedCase {
  name: string;
  route: string;
  status: number;
  body: Record<string, unknown>;
}

const RECORDED: RecordedCase[] = (
  JSON.parse(
    readFileSync(join(here, "../../../connectors/warmbly/fixtures/operator-http-responses.json"), "utf8"),
  ) as { cases: RecordedCase[] }
).cases;

/** What the operator must be told, per recorded case. */
const EXPECTED: Record<string, { kind: DispatchOutcomeKind; recovery: RegExp }> = {
  executed: { kind: "executed", recovery: /trilha|estado do disparo/i },
  challenged: { kind: "challenged", recovery: /confirm/i },
  confirmation_required: { kind: "refused", recovery: /dois passos/i },
  confirmation_invalid: { kind: "refused", recovery: /refaça os dois passos/i },
  missing_actor: { kind: "refused", recovery: /reautentique/i },
  invalid_reason: { kind: "refused", recovery: /motivo/i },
  invalid_target: { kind: "refused", recovery: /id do alerta/i },
  unsupported_media_type: { kind: "refused", recovery: /nada foi aplicado/i },
  upstream_error: { kind: "failed", recovery: /estado do disparo/i },
  circuit_open: { kind: "refused", recovery: /deploy\/confenge-vps\/pause\.sh/ },
  channel_not_configured: { kind: "refused", recovery: /deploy\/confenge-vps\/pause\.sh/ },
};

function recordedCase(name: string): RecordedCase {
  const found = RECORDED.find((item) => item.name === name);
  assert.ok(found, `recorded case ${name} is missing`);
  return found;
}

/**
 * The real HTTP adapter, with GETs served by the shared operational router and
 * the dispatch POST answered with one recorded response.
 */
function adapterReplaying(
  response: { status: number; body: unknown },
  options: { ledger?: { status: number; body: unknown } } = {},
): { adapter: HttpControlCenterAdapter; posts: Array<{ url: string; init: RequestInit }> } {
  const router = operationalRouter();
  const posts: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if ((init?.method ?? "GET") === "POST") {
      posts.push({ url, init: init ?? {} });
      return jsonResponse(response.body, response.status);
    }
    if (path.startsWith("/v1/warmbly/operator/ledger")) {
      const ledger = options.ledger ?? { status: 404, body: { ok: false } };
      return jsonResponse(ledger.body, ledger.status);
    }
    const payload = router(path);
    if (payload === undefined) return jsonResponse({ error: "not_found" }, 404);
    return jsonResponse(payload);
  }) as typeof fetch;
  const adapter = new HttpControlCenterAdapter({
    baseUrl: "https://ops.confenge.com.br",
    fetchImpl,
    operator: { kind: "human", id: "founder-local" },
  });
  return { adapter, posts };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/* ------------------------------------------------------------------ *
 * Route registration.
 * ------------------------------------------------------------------ */

test("Operação Warmbly is a first-class destination with its own read path", () => {
  assert.ok((DESTINATION_IDS as readonly string[]).includes("warmbly"));
  const dest = getDestination("warmbly");
  assert.equal(dest.label, "Operação Warmbly");
  assert.equal(dest.path, "#/warmbly");
  // The dispatch reading lives in the commercial snapshot; the route must read
  // it with the commercial scope and nothing else.
  assert.deepEqual([...readPathsFor("warmbly")], ["/v1/domains/commercial?scope=commercial"]);
});

test("an unknown sub-surface resolves to the operation cockpit instead of a blank page", () => {
  assert.equal(resolveWarmblySurface(null), "operacao");
  assert.equal(resolveWarmblySurface("operacao"), "operacao");
  // A sibling surface that has not shipped yet must not blank the route.
  assert.equal(resolveWarmblySurface("triagem"), "operacao");
  for (const id of WARMBLY_SURFACES) {
    assert.equal(resolveWarmblySurface(id), id);
  }
});

/* ------------------------------------------------------------------ *
 * Every recorded wire shape becomes an explicit verdict plus a next move.
 * ------------------------------------------------------------------ */

test("every recorded channel response is classified as executed, refused, failed or unresolved", async () => {
  assert.ok(RECORDED.length >= 11, "the recording lost cases");
  for (const item of RECORDED) {
    const { adapter } = adapterReplaying(item);
    const result = await adapter.warmblyDispatch({
      action: "pause",
      reason: "pico de bounce",
      target_id: "lead-1",
    });
    const view = classifyDispatchOutcome(result);
    const want = EXPECTED[item.name];
    assert.ok(want, `recorded case ${item.name} has no expected classification`);
    assert.equal(view.kind, want.kind, `${item.name} classified as ${view.kind}`);
    assert.notEqual(
      view.title,
      "Desfecho não classificado",
      `${item.name} fell through to the unclassified default — the recording and the table have drifted`,
    );
    assert.match(view.recovery, want.recovery, `${item.name} recovery guidance`);
    assert.ok(view.detail.length > 0, `${item.name} has no detail line`);
    assert.doesNotMatch(view.detail, /^HTTP \d+$/, `${item.name} detail is a bare status`);
  }
});

test("an executed pause reads as executed, not as a bare HTTP 200", async () => {
  const { adapter } = adapterReplaying(recordedCase("executed"));
  const result = await adapter.warmblyDispatch({ action: "pause", reason: "pico de bounce" });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "executed");
  assert.equal(result.status, 200);
  // The recorded success body carries no `reason` at all, so a naive adapter
  // renders "HTTP 200" here. That is not something an operator can act on.
  assert.match(result.message, /Warmbly aceitou pause_dispatch/);
  assert.equal(classifyDispatchOutcome(result).kind, "executed");
});

test("the three 503s stay three different verdicts, because they demand opposite next moves", async () => {
  const circuit = classifyDispatchOutcome({
    ok: false,
    path: WARMBLY_DISPATCH_PATHS.pause,
    kind: "nota",
    message: "circuito aberto",
    status: 503,
    outcome: "refused",
    code: "circuit_open",
  });
  const preflight = classifyDispatchOutcome({
    ok: false,
    path: WARMBLY_DISPATCH_PATHS.pause,
    kind: "nota",
    message: "nunca escrita",
    status: 503,
    outcome: "refused",
    code: "transport_error",
  });
  const unresolved = classifyDispatchOutcome({
    ok: false,
    path: WARMBLY_DISPATCH_PATHS.pause,
    kind: "nota",
    message: "sem resposta",
    status: 503,
    outcome: "unknown",
    code: "transport_unknown",
  });
  assert.equal(circuit.kind, "refused");
  assert.match(circuit.recovery, /deploy\/confenge-vps\/pause\.sh/);
  assert.equal(preflight.kind, "refused");
  assert.match(preflight.recovery, /Repetir é seguro/);
  assert.equal(unresolved.kind, "unknown");
  assert.match(unresolved.recovery, /Não repita às cegas/);
});

test("a browser-side transport failure is unresolved, never a claim that nothing happened", async () => {
  const fetchImpl = (async () => {
    throw new Error("boom");
  }) as unknown as typeof fetch;
  const adapter = new HttpControlCenterAdapter({
    baseUrl: "https://ops.confenge.com.br",
    fetchImpl,
    operator: { kind: "human", id: "founder-local" },
  });
  const result = await adapter.warmblyDispatch({ action: "pause", reason: "pico de bounce" });
  const view = classifyDispatchOutcome(result);
  assert.equal(view.kind, "unknown");
  assert.match(view.recovery, /não é possível saber|desconhecid/i);
});

test("a refusal this adapter makes before the wire is provably nothing-applied", async () => {
  const { adapter, posts } = adapterReplaying(recordedCase("executed"));
  const result = await adapter.warmblyDispatch({ action: "pause", reason: "  " });
  assert.equal(posts.length, 0, "the call must not have left the browser");
  const view = classifyDispatchOutcome(result);
  assert.equal(view.kind, "refused");
  assert.match(view.recovery, /Nada saiu do navegador/);
});

/* ------------------------------------------------------------------ *
 * The rendered cockpit.
 * ------------------------------------------------------------------ */

function mountWarmbly(hash = "#/warmbly"): { root: { innerHTML: string }; unmount(): void } {
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime(hash));
  return { root, unmount: () => handle.unmount() };
}

test("state, reason, window, queue, limits and last action are all rendered before the controls", () => {
  clearPendingResumeConfirmation();
  const { root, unmount } = mountWarmbly();
  try {
    const html = root.innerHTML;
    assert.match(html, /data-destination="warmbly"/);
    const controls = html.indexOf('id="warmbly-controles"');
    assert.ok(controls > 0, "the controls section must be rendered");
    const head = html.slice(0, controls);
    for (const label of [
      "Estado do disparo",
      "Motivo da pausa",
      "Janela comercial",
      "Aprovados na fila",
      "Enviados na hora / teto",
      "Última ação do operador",
    ]) {
      assert.ok(head.includes(label), `${label} must appear before the controls`);
    }
    // And the forms themselves come after all of it.
    assert.ok(html.indexOf("data-warmbly-dispatch") > controls);
    // Freshness travels with the reading: "PAUSADO" observed an hour ago and
    // observed just now support different decisions.
    assert.ok(head.includes("data-freshness="), "the dispatch reading must carry its provenance");
  } finally {
    unmount();
  }
});

test("the cockpit offers exactly pause, resume and acknowledge, and no send control", () => {
  clearPendingResumeConfirmation();
  const { root, unmount } = mountWarmbly();
  try {
    const actions = [...root.innerHTML.matchAll(/data-warmbly-dispatch="([a-z_]+)"/g)].map((m) => m[1]);
    assert.deepEqual(actions, ["pause", "resume", "acknowledge"]);
    assert.equal(hasMutationControls(root.innerHTML), false);
    assert.doesNotMatch(root.innerHTML, /enviar campanha|SEND_CAMPAIGN|disparar agora/i);
    // The open-circuit caveat has to be standing, not only after a refusal:
    // otherwise the surface implies pause always works.
    assert.match(root.innerHTML, /data-circuit-caveat="true"/);
    assert.ok(root.innerHTML.includes(OUT_OF_BAND_PAUSE_FALLBACK));
  } finally {
    unmount();
  }
});

test("pause is one step and resume announces its two, with the impact of confirming", () => {
  clearPendingResumeConfirmation();
  const { root, unmount } = mountWarmbly();
  try {
    const html = root.innerHTML;
    assert.match(html, /PAUSAR OUTBOUND/);
    assert.match(html, /RETOMAR OUTBOUND \(passo 1 de 2\)/);
    assert.match(html, /data-resume-armed="false"/);
    assert.match(html, /data-resume-impact="true"/);
    assert.match(html, /e-mail frio para empresas reais/);
    // The impact is quantified from the observed queue and cap, not asserted.
    const impact = html.slice(html.indexOf('data-resume-impact="true"'));
    assert.ok(impact.includes("34"), "the approved queue must be part of the impact summary");
    assert.ok(impact.includes("12 / 60"), "sent/cap must be part of the impact summary");
  } finally {
    unmount();
  }
});

test("an armed confirmation changes the resume control from a request into a confirmation", async () => {
  clearPendingResumeConfirmation();
  const challenged = recordedCase("challenged");
  const { adapter } = adapterReplaying(challenged);
  const root = { innerHTML: "" };
  const runtime = createMemoryRuntime("#/warmbly");
  const handle = mount(root, adapter, runtime);
  try {
    await settle();
    assert.match(root.innerHTML, /data-resume-armed="false"/);
    assert.doesNotMatch(root.innerHTML, /data-confirmation-pending="true"/);

    // Drive the real two-step through the real adapter, then repaint.
    const first = await adapter.warmblyDispatch({ action: "resume_confirm", reason: "bounce normalizado" });
    assert.equal(first.ok, true);
    assert.ok(first.confirmationToken, "the recorded challenge carries a token");
    const latest = await adapter.readDestination("warmbly");
    assert.ok(latest.ok && !latest.loading);
    armPendingResumeConfirmation({
      token: first.confirmationToken!,
      reason: "bounce normalizado",
      observation_fingerprint: resumeObservationFingerprint(latest.page.commercial),
    });
    paintShell(root, adapter, "#/warmbly");
    await settle();
    assert.match(root.innerHTML, /data-resume-armed="true"/);
    assert.match(root.innerHTML, /data-confirmation-pending="true"/);
    assert.match(root.innerHTML, /CONFIRMAR RETOMADA \(passo 2 de 2\)/);
    assert.match(root.innerHTML, /name="reason"[^>]*value="bounce normalizado" readonly/);
  } finally {
    handle.unmount();
    clearPendingResumeConfirmation();
  }
});

test("the last outcome is rendered on the cockpit with its recovery instruction", async () => {
  clearPendingResumeConfirmation();
  const { adapter } = adapterReplaying(recordedCase("circuit_open"));
  const root = { innerHTML: "" };
  await adapter.warmblyDispatch({ action: "pause", reason: "pico de bounce" });
  paintShell(root, adapter as ControlCenterReadAdapter, "#/warmbly");
  await settle();
  assert.match(root.innerHTML, /data-dispatch-outcome="refused"/);
  assert.match(root.innerHTML, /data-outcome-code="circuit_open"/);
  assert.match(root.innerHTML, /data-outcome-status="503"/);
  assert.match(root.innerHTML, /data-outcome-recovery="true"/);
  assert.ok(root.innerHTML.includes(OUT_OF_BAND_PAUSE_FALLBACK));
  assert.match(root.innerHTML, /role="alert"/);
});

/* ------------------------------------------------------------------ *
 * Audit trail and operator identity.
 * ------------------------------------------------------------------ */

test("the audit trail renders the recent ledger with the operator recorded on each entry", async () => {
  clearPendingResumeConfirmation();
  const entries = [
    {
      action: "pause_dispatch",
      outcome: "executed",
      actor_id: "founder",
      target: "dispatch:confenge-dispatch",
      reason: "pico de bounce",
      refusal_code: null,
      upstream_status: 200,
      recorded_at: "2026-08-20T17:38:00Z",
      correlation_id: "wop_1",
    },
  ];
  const { adapter } = adapterReplaying(recordedCase("executed"), {
    ledger: { status: 200, body: { ok: true, entries } },
  });
  const root = { innerHTML: "" };
  paintShell(root, adapter as ControlCenterReadAdapter, "#/warmbly");
  await settle();
  assert.match(root.innerHTML, /data-ledger-status="read"/);
  assert.match(root.innerHTML, /data-ledger-entry="executed"/);
  assert.match(root.innerHTML, /pico de bounce/);
  assert.match(root.innerHTML, /Operador registrado/);
  assert.match(root.innerHTML, /data-operator-identity="true"/);
  assert.match(root.innerHTML, /control-center\.warmbly-operator-action\.v1/);
});

test("an unreadable trail is never rendered as an empty one", async () => {
  clearPendingResumeConfirmation();
  // 404: the operator channel is off in this deployment, which is the shipped
  // default. Saying "nobody acted" here would be a lie about the audit trail.
  const { adapter } = adapterReplaying(recordedCase("executed"), {
    ledger: { status: 404, body: { ok: false, code: "operator_channel_not_configured" } },
  });
  const root = { innerHTML: "" };
  paintShell(root, adapter as ControlCenterReadAdapter, "#/warmbly");
  await settle();
  assert.match(root.innerHTML, /data-ledger-status="not_mounted"/);
  assert.match(root.innerHTML, /não está montado/);
  assert.doesNotMatch(root.innerHTML, /Trilha lida e vazia/);

  const broken = adapterReplaying(recordedCase("executed"), {
    ledger: { status: 500, body: { ok: false } },
  });
  const other = { innerHTML: "" };
  paintShell(other, broken.adapter as ControlCenterReadAdapter, "#/warmbly");
  await settle();
  assert.match(other.innerHTML, /data-ledger-status="unreadable"/);
  assert.match(other.innerHTML, /Ilegível não é vazia/);
});

test("a read-but-empty trail says so without claiming nobody acted", async () => {
  clearPendingResumeConfirmation();
  const { adapter } = adapterReplaying(recordedCase("executed"), {
    ledger: { status: 200, body: { ok: true, entries: [] } },
  });
  const root = { innerHTML: "" };
  paintShell(root, adapter as ControlCenterReadAdapter, "#/warmbly");
  await settle();
  assert.match(root.innerHTML, /data-ledger-status="read"/);
  assert.match(root.innerHTML, /Trilha lida e vazia/);
  assert.match(root.innerHTML, /não prova que ninguém agiu/);
});

test("ledger content is escaped: an audit trail is attacker-adjacent text", async () => {
  clearPendingResumeConfirmation();
  const payload = `<img src=x onerror="alert(1)">`;
  const { adapter } = adapterReplaying(recordedCase("executed"), {
    ledger: {
      status: 200,
      body: {
        ok: true,
        entries: [
          {
            action: payload,
            outcome: "executed",
            actor_id: payload,
            target: payload,
            reason: payload,
            refusal_code: null,
            upstream_status: 200,
            recorded_at: "2026-08-20T17:38:00Z",
            correlation_id: payload,
          },
        ],
      },
    },
  });
  const root = { innerHTML: "" };
  paintShell(root, adapter as ControlCenterReadAdapter, "#/warmbly");
  await settle();
  assert.doesNotMatch(root.innerHTML, /<img src=x/);
  assert.match(root.innerHTML, /&lt;img/);
});

/* ------------------------------------------------------------------ *
 * The state reading itself.
 * ------------------------------------------------------------------ */

test("an unobserved dispatch reading is UNKNOWN and says so, never ACTIVE by default", async () => {
  clearPendingResumeConfirmation();
  const router = operationalRouter();
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "");
    if ((init?.method ?? "GET") === "POST") return jsonResponse({ ok: true }, 200);
    if (path.startsWith("/v1/warmbly/operator/ledger")) return jsonResponse({ ok: false }, 404);
    const payload = router(path);
    if (payload === undefined) return jsonResponse({ error: "not_found" }, 404);
    return jsonResponse(payload);
  }) as typeof fetch;
  const adapter = new HttpControlCenterAdapter({
    baseUrl: "https://ops.confenge.com.br",
    fetchImpl,
    operator: { kind: "human", id: "founder-local" },
  });
  const root = { innerHTML: "" };
  paintShell(root, adapter as ControlCenterReadAdapter, "#/warmbly");
  await settle();
  // The shared contract fixture carries no `operations.dispatch`, which is
  // exactly the "collector produced no reading" case.
  assert.match(root.innerHTML, /data-dispatch-state="UNKNOWN"/);
  assert.match(root.innerHTML, /data-dispatch-observed="false"/);
  assert.match(root.innerHTML, /DESCONHECIDO não é ATIVO nem PAUSADO/);
  assert.match(root.innerHTML, /data-impact-unquantified="true"/);
});

test("the dispatch controls left Comercial > Coortes and point at the new route", () => {
  clearPendingResumeConfirmation();
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime("#/comercial/cohorts"));
  try {
    assert.doesNotMatch(root.innerHTML, /data-warmbly-dispatch/);
    assert.doesNotMatch(root.innerHTML, /PAUSAR OUTBOUND/);
    assert.match(root.innerHTML, /data-dispatch-moved="true"/);
    assert.match(root.innerHTML, /href="#\/warmbly"/);
  } finally {
    handle.unmount();
  }
});

test("the dispatch write still carries no client-settable actor from this route", async () => {
  const { adapter, posts } = adapterReplaying(recordedCase("executed"));
  await adapter.warmblyDispatch({ action: "pause", reason: "pico de bounce" });
  assert.equal(posts.length, 1);
  const headers = (posts[0]!.init.headers ?? {}) as Record<string, string>;
  assert.equal(headers["x-actor-id"], undefined);
  assert.equal(headers["x-actor-kind"], undefined);
  assert.equal((posts[0]!.init as { credentials?: string }).credentials, "include");
  const result: AdapterWriteResult | undefined = adapter.lastOperatorResult;
  assert.ok(result?.ok);
});
