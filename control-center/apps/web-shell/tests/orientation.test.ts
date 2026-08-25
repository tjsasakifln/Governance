import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { DestinationPage } from "../src/adapters/contract";
import {
  COMMERCIAL_SURFACES,
  DESTINATION_IDS,
  WARMBLY_SURFACES,
  type DestinationId,
} from "../src/destinations";
import { ATTENTION_FIXTURES, PRIORITY_FIXTURES } from "../src/fixtures/catalog";
import {
  ORIENTATION_FIELDS,
  buildOrientationSummary,
  renderOrientationSummary,
} from "../src/ui/orientation";
import { renderShell } from "../src/ui/render";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function page(destination: DestinationId): DestinationPage {
  return {
    id: destination,
    label: destination,
    scope: "company",
    generated_at: "2026-08-20T18:00:00Z",
    operator: { kind: "human", id: "human:operator" },
    headline: "Recorte operacional",
    attention: [],
    priorities: [],
  };
}

test("every registered destination renders state, risk and next action before its content", () => {
  assert.deepEqual(ORIENTATION_FIELDS, ["state", "risk", "next-action"]);
  for (const destination of DESTINATION_IDS) {
    const html = renderShell({
      destination,
      viewKind: "ready",
      adapterMode: "http",
      mockScenario: "http",
      view: { kind: "ready", data: page(destination) },
    });
    const orientationIndex = html.indexOf('data-orientation-contract="v1"');
    const bodyIndex = html.indexOf('id="orientacao-conteudo"');
    assert.ok(orientationIndex >= 0, `${destination} has orientation contract`);
    assert.ok(bodyIndex > orientationIndex, `${destination} places orientation before content`);
    for (const field of ORIENTATION_FIELDS) {
      assert.match(html, new RegExp(`data-orientation-field="${field}"`));
    }
    assert.equal([...html.matchAll(/data-orientation-field=/g)].length, 3);
  }

  for (const [destination, surfaces] of [
    ["comercial", COMMERCIAL_SURFACES],
    ["warmbly", WARMBLY_SURFACES],
  ] as const) {
    for (const surface of surfaces) {
      const html = renderShell({
        destination,
        surface,
        viewKind: "ready",
        adapterMode: "http",
        mockScenario: "http",
        view: { kind: "ready", data: page(destination) },
      });
      assert.match(html, /data-orientation-contract="v1"/);
      assert.equal([...html.matchAll(/data-orientation-field=/g)].length, 3);
    }
  }
});

test("the most severe unresolved alert owns one unambiguous primary action", () => {
  const data = page("hoje");
  data.attention = [
    { ...ATTENTION_FIXTURES[2]!, recommended_action: "Revisar o CI" },
    {
      ...ATTENTION_FIXTURES[0]!,
      recommended_action: "Inspecionar a coleta",
      provenance: {
        ...ATTENTION_FIXTURES[0]!.provenance,
        freshness_status: "FRESH",
      },
    },
  ];
  data.priorities = [PRIORITY_FIXTURES[0]!];

  const summary = buildOrientationSummary({
    destination: "hoje",
    view: { kind: "ready", data },
  });
  assert.match(summary.risk.label, /^Risco crítico:/);
  assert.equal(summary.action.label, "Inspecionar a coleta");
  assert.equal(summary.action.kind, "act");

  const html = renderOrientationSummary(summary);
  assert.equal([...html.matchAll(/data-orientation-primary-action=/g)].length, 1);
  assert.match(html, /href="#orientacao-conteudo"/);
});

test("acknowledging an alert does not misrepresent it as resolved", () => {
  const data = page("infra");
  data.attention = [
    {
      ...ATTENTION_FIXTURES[0]!,
      status: "acknowledged",
      provenance: {
        ...ATTENTION_FIXTURES[0]!.provenance,
        freshness_status: "FRESH",
      },
    },
  ];

  const summary = buildOrientationSummary({
    destination: "infra",
    view: { kind: "ready", data },
  });
  assert.match(summary.risk.detail, /ainda não está resolvido/i);
  assert.equal(summary.action.kind, "act");
});

test("resolved alerts supply freshness but never re-enter the action queue", () => {
  const data = page("engenharia");
  data.attention = [
    {
      ...ATTENTION_FIXTURES[2]!,
      status: "resolved",
      provenance: {
        ...ATTENTION_FIXTURES[2]!.provenance,
        freshness_status: "FRESH",
      },
    },
  ];

  const summary = buildOrientationSummary({
    destination: "engenharia",
    view: { kind: "ready", data },
  });
  assert.equal(summary.risk.label, "Nenhum risco acionável observado");
  assert.equal(summary.action.kind, "none");
  assert.equal(summary.action.href, null);
});

test("worst provenance wins and partial failure is never painted healthy", () => {
  const data = page("infra");
  data.attention = [
    {
      ...ATTENTION_FIXTURES[2]!,
      status: "resolved",
      provenance: {
        ...ATTENTION_FIXTURES[2]!.provenance,
        freshness_status: "FRESH",
      },
    },
    { ...ATTENTION_FIXTURES[0]!, status: "resolved" },
  ];

  const summary = buildOrientationSummary({
    destination: "infra",
    view: { kind: "ready", data },
  });
  assert.equal(summary.state.label, "Leitura parcial com erro");
  assert.equal(summary.state.tone, "critical");
  assert.match(summary.risk.detail, /não interprete.*ausência/i);
  assert.equal(summary.action.kind, "recover");
});

test("a stale view overrides an otherwise fresh payload", () => {
  const data = page("financeiro");
  data.attention = [
    {
      ...ATTENTION_FIXTURES[2]!,
      status: "resolved",
      provenance: {
        ...ATTENTION_FIXTURES[2]!.provenance,
        freshness_status: "FRESH",
      },
    },
  ];

  const summary = buildOrientationSummary({
    destination: "financeiro",
    view: { kind: "stale", data, message: "Recorte defasado" },
  });
  assert.equal(summary.state.label, "Há dados desatualizados");
  assert.equal(summary.state.tone, "attention");
  assert.match(summary.action.label, /origem antes de agir/i);
});

test("loading, empty, generic error and permission denial have distinct recovery copy", () => {
  const loading = buildOrientationSummary({
    destination: "clientes",
    view: { kind: "loading" },
  });
  const empty = buildOrientationSummary({
    destination: "clientes",
    view: { kind: "empty", message: "Nenhum cliente neste recorte." },
  });
  const error = buildOrientationSummary({
    destination: "clientes",
    view: { kind: "error", code: "UPSTREAM_ERROR", message: "falhou" },
  });
  const denied = buildOrientationSummary({
    destination: "clientes",
    view: { kind: "error", code: "PERMISSION_DENIED", message: "forbidden" },
  });

  assert.equal(loading.action.kind, "wait");
  assert.equal(empty.action.kind, "none");
  assert.equal(error.action.href, "");
  assert.match(error.action.label, /recarregar/i);
  assert.match(denied.state.label, /sem permissão/i);
  assert.equal(denied.action.href, null);
  assert.match(denied.action.detail, /não tente contornar/i);
});

test("missing provenance remains unknown instead of becoming a healthy zero", () => {
  const summary = buildOrientationSummary({
    destination: "memoria",
    view: { kind: "ready", data: page("memoria") },
  });
  assert.equal(summary.state.tone, "unknown");
  assert.match(summary.state.label, /atualidade não comprovada/i);
  assert.match(summary.risk.detail, /ausência de alertas não autoriza/i);
  assert.equal(summary.action.kind, "recover");
});

test("priority is used only when no unresolved alert exists", () => {
  const data = page("comercial");
  data.priorities = [{ ...PRIORITY_FIXTURES[0]!, recommended_action: "Abrir a prioridade" }];

  const summary = buildOrientationSummary({
    destination: "comercial",
    view: { kind: "ready", data },
  });
  assert.match(summary.risk.label, /^Prioridade 1:/);
  assert.equal(summary.action.label, "Abrir a prioridade");
});

test("human update time is visible while the exact instant remains machine-readable", () => {
  const data = page("agentes");
  data.attention = [{ ...ATTENTION_FIXTURES[2]!, status: "resolved" }];
  const summary = buildOrientationSummary({
    destination: "agentes",
    view: { kind: "ready", data },
  });
  const html = renderOrientationSummary(summary);

  assert.match(html, /datetime="2026-08-20T18:00:00Z"/);
  assert.match(html, /20\/08\/2026/);
  assert.match(html, /America\/Sao_Paulo/);
});

test("untrusted alert and action text is escaped in the first viewport", () => {
  const payload = '<img src=x onerror="alert(1)">';
  const data = page("hoje");
  data.attention = [
    {
      ...ATTENTION_FIXTURES[0]!,
      title: payload,
      summary: payload,
      recommended_action: payload,
      provenance: {
        ...ATTENTION_FIXTURES[0]!.provenance,
        freshness_status: "FRESH",
      },
    },
  ];
  const html = renderOrientationSummary(
    buildOrientationSummary({ destination: "hoje", view: { kind: "ready", data } }),
  );

  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /onerror="/);
  assert.match(html, /&lt;img/);
});

test("non-fresh evidence suppresses a domain action even when the source recommends it", () => {
  const data = page("hoje");
  data.attention = [
    {
      ...ATTENTION_FIXTURES[0]!,
      recommended_action: "Executar uma ação de domínio",
    },
  ];
  const summary = buildOrientationSummary({
    destination: "hoje",
    view: { kind: "ready", data },
  });

  assert.equal(summary.state.tone, "critical");
  assert.equal(summary.action.kind, "recover");
  assert.notEqual(summary.action.label, "Executar uma ação de domínio");
  assert.match(summary.action.label, /coleta antes de agir/i);
});

test("mobile orientation is compact and its only actionable target is touch-sized", () => {
  const css = readFileSync(join(rootDir, "src/styles.css"), "utf8");
  assert.match(css, /\.orientation-grid\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.orientation-primary-action\s*\{[^}]*min-height:\s*44px/s);
  assert.match(
    css,
    /@media \(min-width: 880px\)[\s\S]*\.orientation-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/,
  );
});
