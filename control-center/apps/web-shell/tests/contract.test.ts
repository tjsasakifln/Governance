import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createMockAdapter } from "../src/adapters/index";
import { createMemoryRuntime, mount } from "../src/app";
import { DIRECTIVE_FIXTURES } from "../src/fixtures/catalog";
import { DIRECTIVE_KINDS } from "../src/types";
import { hasChatComposer, hasMutationControls } from "../src/ui/render";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

test("directives carry kind, scope, status, vigência, supersedes, created_by and audit", () => {
  const kinds = new Set(DIRECTIVE_FIXTURES.map((item) => item.kind));
  for (const kind of DIRECTIVE_KINDS) {
    assert.equal(kinds.has(kind), true, `missing directive kind ${kind}`);
  }
  for (const item of DIRECTIVE_FIXTURES) {
    assert.ok(item.scope.length > 0);
    assert.ok(item.status.length > 0);
    assert.ok(item.effective_from.endsWith("Z"));
    assert.ok(item.expires_at === null || item.expires_at.endsWith("Z"));
    assert.ok(item.supersedes === null || Array.isArray(item.supersedes));
    assert.ok(item.created_by.id);
    assert.ok(item.audit.length >= 1);
  }
});

test("mounted Hoje HTML is an attention cockpit without chat or mutation controls", () => {
  const root = { innerHTML: "" };
  const runtime = createMemoryRuntime("#/hoje");
  const handle = mount(root, createMockAdapter(), runtime);
  try {
    assert.match(root.innerHTML, /data-destination="hoje"/);
    assert.match(root.innerHTML, /Se eu só puder fazer 3 coisas hoje\./);
    assert.match(root.innerHTML, /Incidentes, blockers e riscos\./);
    assert.match(root.innerHTML, /aria-label="Áreas do Control Center"/);
    for (const label of [
      "Hoje",
      "Comercial",
      "Clientes",
      "Financeiro",
      "Engenharia",
      "Infra",
      "Memória/Decisões",
      "Agentes",
    ]) {
      assert.match(root.innerHTML, new RegExp(label.replace("/", "\\/")));
    }
    const ranks = [...root.innerHTML.matchAll(/data-rank="(\d+)"/g)].map((m) => Number(m[1]));
    assert.ok(ranks.length > 0);
    assert.ok(ranks.length <= 3);
    assert.ok(root.innerHTML.includes("data-severity="));
    assert.equal(hasChatComposer(root.innerHTML), false);
    assert.equal(hasMutationControls(root.innerHTML), false);
    assert.match(root.innerHTML, /data-shortcut-form="decision"/);
    assert.doesNotMatch(root.innerHTML, /type="password"/i);
  } finally {
    handle.unmount();
  }
});

test("driving a nav hash changes the visible destination", () => {
  const root = { innerHTML: "" };
  const runtime = createMemoryRuntime("#/hoje");
  const handle = mount(root, createMockAdapter(), runtime);
  try {
    runtime.setHash("#/financeiro");
    assert.match(root.innerHTML, /data-destination="financeiro"/);
    assert.match(root.innerHTML, /data-amount-cents="1500000"/);
    assert.match(root.innerHTML, /data-currency="BRL"/);
    assert.match(root.innerHTML, /Mutações de provedor: proibidas/);
    // O identificador não sumiu: desceu para o bloco recolhido e copiável.
    assert.match(root.innerHTML, /read_model_only=true/);
    assert.match(
      root.innerHTML,
      /<details class="tech" data-tech="finance-authority">[\s\S]*?read_model_only[\s\S]*?<\/details>/,
    );
    runtime.setHash("#/hoje?view=loading");
    assert.match(root.innerHTML, /data-view-state="loading"/);
    runtime.setHash("#/hoje?view=error");
    assert.match(root.innerHTML, /data-view-state="error"/);
    runtime.setHash("#/hoje?view=empty");
    assert.match(root.innerHTML, /data-view-state="empty"/);
    runtime.setHash("#/hoje?view=stale");
    assert.match(root.innerHTML, /data-view-state="stale"/);
  } finally {
    handle.unmount();
  }
});

test("README names destinations, mock-only mode, run commands and later convergence", () => {
  const readme = readFileSync(join(rootDir, "README.md"), "utf8");
  for (const label of [
    "Hoje",
    "Comercial",
    "Clientes",
    "Financeiro",
    "Engenharia",
    "Infra",
    "Memória/Decisões",
    "Agentes",
  ]) {
    assert.ok(readme.includes(label), `README missing ${label}`);
  }
  assert.match(readme, /npm run dev/);
  assert.match(readme, /npm run preview/);
  assert.match(readme, /npm test/);
  assert.match(readme, /nenhum|None required|Nenhuma/i);
  assert.match(readme, /MCP/);
  assert.match(readme, /PostgreSQL/);
  assert.match(readme, /converg/i);
  assert.match(readme, /mock/i);
});
