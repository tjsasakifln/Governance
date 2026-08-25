import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createMockAdapter } from "../src/adapters/mock";
import { createMemoryRuntime, mount } from "../src/app";
import { installShellGlobals, type ShellWindow } from "../src/boot";
import {
  OPERATIONAL_COMPONENT_CONTRACT,
  OPERATIONAL_STATE_IDS,
  OPERATIONAL_STATES,
  operationalActionBar,
  operationalFeedback,
  renderOperationalComponentCatalog,
} from "../src/ui/design-system";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every semantic state has symbol, authored label, role and non-color text", () => {
  assert.equal(OPERATIONAL_STATE_IDS.length, 8);
  for (const state of OPERATIONAL_STATE_IDS) {
    const definition = OPERATIONAL_STATES[state];
    assert.ok(definition.label.length > 2);
    assert.ok(definition.symbol.length > 0);
    const html = operationalFeedback({ state, title: "Estado observado", body: "Próxima ação explícita." });
    assert.match(html, new RegExp(`data-operational-state="${state}"`));
    assert.ok(html.includes(definition.label));
    assert.match(html, /Estado observado/);
    assert.match(html, /Próxima ação explícita/);
    assert.match(html, /role="(?:alert|status)"/);
  }
});

test("action bar allows exactly zero or one primary action", () => {
  const active = operationalActionBar({
    label: "Ações",
    primary: { label: "Confirmar", href: "#/hoje" },
    secondary: [{ label: "Voltar", href: "#evidencia" }],
  });
  assert.match(active, /data-primary-actions="1"/);
  assert.equal(active.match(/class="operational-primary-action/g)?.length, 1);
  assert.equal(active.match(/class="operational-secondary-action/g)?.length, 1);
  const passive = operationalActionBar({ label: "Ações", guidance: "Nenhuma ação agora" });
  assert.match(passive, /data-primary-actions="0"/);
  assert.doesNotMatch(passive, /operational-primary-action/);
});

test("catalog covers ten real contracts, extreme states, missing data and long copy", () => {
  assert.equal(OPERATIONAL_COMPONENT_CONTRACT.length, 10);
  assert.equal(new Set(OPERATIONAL_COMPONENT_CONTRACT.map((component) => component.id)).size, 10);
  const html = renderOperationalComponentCatalog();
  for (const state of OPERATIONAL_STATE_IDS) {
    assert.match(html, new RegExp(`data-operational-state="${state}"`));
  }
  assert.match(html, /Dado<\/dt><dd>ausente/);
  assert.match(html, /Texto longo de fixture/);
  assert.match(html, /data-review-list-item/);
  assert.match(html, /class="operator-form"/);
  assert.match(html, /data-operational-confirmation/);
  assert.match(html, /data-tech="component-catalog"/);
});

test("global shell adopts page header, state summary, action bar and feedback helpers", () => {
  const root = { innerHTML: "" };
  mount(root, createMockAdapter(), createMemoryRuntime("#/hoje?view=loading"));
  assert.match(root.innerHTML, /data-operational-component="page-header"/);
  assert.match(root.innerHTML, /data-operational-component="state-summary"/);
  assert.match(root.innerHTML, /data-operational-component="action-bar"/);
  assert.match(root.innerHTML, /data-operational-component="feedback"/);
  assert.match(root.innerHTML, /data-operational-state="loading"/);

  const win: ShellWindow = { location: { protocol: "https:" } };
  const globals = installShellGlobals(win);
  assert.equal(globals.designSystem.components.length, 10);
  assert.match(globals.designSystem.renderCatalog(), /data-operational-catalog="v1"/);
});

test("semantic token dimensions and catalog visual gate remain source-controlled", () => {
  const css = readFileSync(join(app, "src/styles.css"), "utf8");
  for (const token of [
    "--surface-page", "--text-primary", "--state-critical", "--space-1",
    "--radius-control", "--elevation-overlay", "--focus-width",
    "--control-min-size", "--measure-reading", "--type-page", "--motion-fast",
  ]) assert.ok(css.includes(token), `missing ${token}`);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  const probe = readFileSync(join(app, "scripts/launch-probe.mjs"), "utf8");
  assert.match(probe, /component_catalog=PASS/);
  assert.match(probe, /"390" \|\| viewport\.name === "desktop-1440"/);
});
