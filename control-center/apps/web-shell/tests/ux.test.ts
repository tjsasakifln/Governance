import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createMemoryRuntime, mount } from "../src/app";
import { createMockAdapter } from "../src/adapters/index";
import { PRESENTATION_TIME_ZONE } from "../src/datetime";
import { formatMoney } from "../src/money";
import { escapeHtml } from "../src/escape";
import { freshnessTone, neverGreenStatuses } from "../src/freshness-tone";
import { renderShell } from "../src/ui/render";
import { AUTH_URL, PRODUCTIVE_URL } from "../src/topology";
import { ATTENTION_FIXTURES } from "../src/fixtures/catalog";
import { loadingState, errorState, emptyState, staleState, readyState } from "../src/view-state";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

test("money is integer cents plus ISO currency", () => {
  assert.equal(formatMoney({ amount_cents: 1500000, currency: "BRL" }), "BRL 15.000,00");
  assert.throws(() => formatMoney({ amount_cents: 1.5, currency: "BRL" }));
  assert.throws(() => formatMoney({ amount_cents: 1, currency: "brl" }));
});

test("observed_at stays UTC Z in data and America/Sao_Paulo in the visible string", () => {
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime("#/hoje"));
  try {
    assert.match(root.innerHTML, /datetime="2026-08-20T17:/);
    assert.match(root.innerHTML, new RegExp(PRESENTATION_TIME_ZONE.replace("/", "\\/")));
    assert.match(root.innerHTML, /sr-only">UTC /);
  } finally {
    handle.unmount();
  }
});

test("XSS payloads in titles/bodies are escaped in HTML", () => {
  const payload = `<img src=x onerror="alert(1)">`;
  const escaped = escapeHtml(payload);
  assert.equal(escaped.includes("<img"), false);
  const html = renderShell({
    destination: "hoje",
    viewKind: "ready",
    mockScenario: "http",
    adapterMode: "http",
    view: {
      kind: "ready",
      data: {
        id: "hoje",
        label: "Hoje",
        scope: "company",
        generated_at: "2026-08-20T18:00:00Z",
        operator: { kind: "human", id: "human:operator" },
        headline: payload,
        attention: [
          {
            ...ATTENTION_FIXTURES[0]!,
            title: payload,
            summary: `<script>alert("xss")</script>`,
          },
        ],
        priorities: [],
      },
    },
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;img/);
});

test("STALE/UNKNOWN/ERROR have non-color text labels and are never green", () => {
  for (const status of neverGreenStatuses()) {
    assert.notEqual(freshnessTone(status), "green");
  }
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime("#/hoje"));
  try {
    assert.match(root.innerHTML, /STALE/);
    assert.match(root.innerHTML, /ERROR/);
    assert.match(root.innerHTML, /UNKNOWN|desconhecido|erro de coleta|defasado/);
    assert.match(root.innerHTML, /sr-only/);
    const errorBlocks = [...root.innerHTML.matchAll(/data-freshness="ERROR"[\s\S]{0,400}data-tone="([^"]+)"/g)];
    for (const match of errorBlocks) {
      assert.notEqual(match[1], "green");
    }
  } finally {
    handle.unmount();
  }
});

test("loading, empty, stale and error remain distinct view states", () => {
  assert.equal(loadingState().kind, "loading");
  assert.equal(errorState().kind, "error");
  assert.equal(emptyState().kind, "empty");
  assert.equal(staleState({}).kind, "stale");
  assert.equal(readyState({}).kind, "ready");
  const root = { innerHTML: "" };
  const runtime = createMemoryRuntime("#/hoje?view=loading");
  const handle = mount(root, createMockAdapter(), runtime);
  try {
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

test("global and contextual navigation need no horizontal discovery", () => {
  const css = readFileSync(join(rootDir, "src/styles.css"), "utf8");
  assert.match(css, /html,\s*body\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.doesNotMatch(css, /\.nav\s*\{[^}]*overflow-x:\s*auto/s);
  assert.doesNotMatch(css, /\.subnav\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.task-nav\s*\{[^}]*grid-template-columns:\s*repeat\(5,/s);
  assert.match(css, /\.subnav\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.match(css, /min-height:\s*44px/);
  assert.match(
    css,
    /@media \(max-width:\s*520px\)[\s\S]*?\.facts div,[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(css, /\.table-wrap\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/s);
});

/**
 * Static guards for the desktop layout contract. They pin the declarations, not
 * the rendered geometry -- the behavioural proof lives in
 * scripts/launch-probe.mjs, which measures the real build in Chromium at
 * 1366x768, 1440x900 and 1920x1080 and fails on a dead right-hand panel or a
 * second vertical scroll context.
 */
test("main is a single full-bleed scroll context with a centred, capped content column", () => {
  const css = readFileSync(join(rootDir, "src/styles.css"), "utf8");
  const mainBlock = /\nmain\s*\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(mainBlock, "top-level main rule not found");

  // The design system, not a magic number in one rule, owns the measure.
  assert.match(css, /:root\s*\{[^}]*--content-max:\s*[\d.]+rem/s);
  assert.match(mainBlock, /padding-inline:\s*max\(\s*var\(--main-gutter\)/);
  assert.match(mainBlock, /--content-max/);
  // A bare max-width on the scroll container is the regression being fixed: it
  // pins the content to the left edge of the desktop grid column.
  assert.doesNotMatch(mainBlock, /^\s*max-width\s*:/m);

  // main owns the only vertical scroll context.
  assert.match(mainBlock, /overflow-y:\s*auto/);
  assert.match(mainBlock, /overscroll-behavior-y:\s*contain/);
  // Without a positioned ancestor the .sr-only absolutes inside the page body
  // resolve against the initial containing block, escape this scroll container
  // and inflate the document scrolling area into a second scrollbar.
  assert.match(mainBlock, /position:\s*relative/);

  // The desktop sidebar stretches to its grid row; a guessed topbar height
  // pushes the shell past the viewport and adds a third scroll context.
  assert.doesNotMatch(css, /height:\s*calc\(100dvh\s*-/);
  assert.match(css, /grid-template-columns:\s*13\.5rem\s+minmax\(0,\s*1fr\)/);
});

test("keyboard-focusable nav exists and skip link is present", () => {
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime("#/hoje"));
  try {
    assert.match(root.innerHTML, /class="skip-link"/);
    assert.match(root.innerHTML, /href="#conteudo"/);
    assert.match(root.innerHTML, /nav class="nav"/);
    assert.match(root.innerHTML, /data-nav="hoje"/);
    assert.match(root.innerHTML, /tabindex="-1"/);
  } finally {
    handle.unmount();
  }
});

test("productive topology is ops.confenge.com.br with auth.ops; no secrets/PII in sources", () => {
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime("#/hoje"));
  try {
    assert.match(root.innerHTML, new RegExp(PRODUCTIVE_URL.replaceAll("/", "\\/")));
    assert.match(root.innerHTML, new RegExp(AUTH_URL.replaceAll("/", "\\/")));
    assert.doesNotMatch(root.innerHTML, /\/intranet/);
  } finally {
    handle.unmount();
  }
  const scanDirs = [join(rootDir, "src")];
  const secret = /(sk_live|sk_test|ghp_[A-Za-z0-9]{20,}|BEGIN PRIVATE KEY|password\s*=\s*['"][^'"]+['"])/i;
  const pii = /\b[A-Z][a-z]+ [A-Z][a-z]+ \d{3}\.\d{3}\.\d{3}-\d{2}\b/;
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|css|svg|webmanifest)$/.test(entry.name)) continue;
      const text = readFileSync(full, "utf8");
      assert.equal(secret.test(text), false, `secret-like token in ${full}`);
      assert.equal(pii.test(text), false, `PII dump in ${full}`);
    }
  }
  for (const dir of scanDirs) walk(dir);
});
