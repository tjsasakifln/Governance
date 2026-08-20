import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { runCli } from "../src/cli.js";
import { BAND_LABELS } from "../src/compose.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("hoje.js is a classic script with no unguarded Node require/module.exports", () => {
  const js = readFileSync(join(root, "public/hoje.js"), "utf8");
  assert.doesNotMatch(js, /\brequire\s*\(/);
  assert.doesNotMatch(js, /\bmodule\.exports\b/);
  assert.doesNotMatch(js, /\bexports\./);
  assert.match(js, /__CONFENGE_HOJE__/);
});

test("generate-public writes fire page with eight bands and file:-safe scripts", () => {
  const gen = runCli(["generate-public"]);
  assert.equal(gen.code, 0);
  const html = readFileSync(join(root, "public/hoje.html"), "utf8");
  assert.match(html, /<h1>HOJE<\/h1>/);
  for (const label of BAND_LABELS) {
    assert.ok(html.includes(label), label);
  }
  assert.match(html, /<script src="\.\/hoje\.js">/);
  assert.doesNotMatch(html, /type="module"/);
  assert.doesNotMatch(html, /<canvas/i);
  assert.match(html, /data-fixture="incendio-operacional"/);
  assert.match(html, /data-founder-override="pin"/);
  assert.match(html, /data-shortcut="decision"/);
  assert.match(html, /data-shortcut="nota"/);
  const css = readFileSync(join(root, "public/hoje.css"), "utf8");
  assert.match(css, /max-width/);
});
