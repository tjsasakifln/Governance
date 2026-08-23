import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createMemoryRuntime, mount } from "../src/app";
import { createMockAdapter } from "../src/adapters/index";
import {
  BRAND_LOGO_FILE,
  BRAND_LOGO_HEIGHT,
  BRAND_LOGO_SRC,
  BRAND_LOGO_WIDTH,
} from "../src/brand";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicAsset = join(appDir, "public", BRAND_LOGO_FILE);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Minimal PNG header reader: signature + the IHDR chunk that must lead the file. */
function readPngHeader(bytes: Buffer): {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
} {
  assert.equal(bytes.subarray(0, 8).equals(PNG_SIGNATURE), true, "not a PNG");
  assert.equal(bytes.subarray(12, 16).toString("latin1"), "IHDR", "PNG does not lead with IHDR");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes.readUInt8(24),
    colorType: bytes.readUInt8(25),
  };
}

function renderedShell(hash = "#/hoje"): string {
  const root = { innerHTML: "" };
  const handle = mount(root, createMockAdapter(), createMemoryRuntime(hash));
  try {
    return root.innerHTML;
  } finally {
    handle.unmount();
  }
}

test("the official CONFENGE white mark ships unaltered in public/", () => {
  assert.equal(existsSync(publicAsset), true, `missing brand asset at ${publicAsset}`);
  const header = readPngHeader(readFileSync(publicAsset));
  // Intrinsic size and RGBA colour type are the fingerprint of the untouched
  // official file: a re-encode, a resize, or a flatten onto an opaque matte
  // would move at least one of them.
  assert.equal(header.width, BRAND_LOGO_WIDTH);
  assert.equal(header.height, BRAND_LOGO_HEIGHT);
  assert.equal(header.bitDepth, 8);
  assert.equal(header.colorType, 6, "brand asset lost its alpha channel");
});

test("the dark topbar leads with the CONFENGE mark linking to #/hoje", () => {
  const html = renderedShell();
  const brand = /<a class="brand" href="([^"]+)"[\s\S]*?<\/a>/.exec(html);
  assert.ok(brand, "topbar has no brand link");
  assert.equal(brand[1], "#/hoje");
  const markup = brand[0];

  assert.match(markup, /<img\b/, "brand link carries no image");
  assert.match(markup, /alt="CONFENGE"/);
  assert.match(markup, new RegExp(`src="${BRAND_LOGO_SRC.replace(".", "\\.")}"`));
  assert.match(markup, new RegExp(`width="${BRAND_LOGO_WIDTH}"`));
  assert.match(markup, new RegExp(`height="${BRAND_LOGO_HEIGHT}"`));

  // "Control Center" survives as the secondary product name, not as identity.
  assert.match(markup, /<span class="brand-product">Control Center<\/span>/);
  assert.doesNotMatch(html, /<p class="brand">/);

  // No improvised typographic wordmark stands in for the asset.
  assert.doesNotMatch(markup.replace(/alt="CONFENGE"/, ""), /CONFENGE/);
});

test("the brand mark is on every destination, not only Hoje", () => {
  for (const hash of ["#/comercial", "#/clientes", "#/infra", "#/agentes"]) {
    const html = renderedShell(hash);
    assert.match(html, /<a class="brand" href="#\/hoje"/, `no brand link on ${hash}`);
    assert.match(html, /alt="CONFENGE"/, `no CONFENGE mark on ${hash}`);
  }
});

test("brand CSS preserves the aspect ratio and never recolours the mark", () => {
  const css = readFileSync(join(appDir, "src/styles.css"), "utf8");
  const rule = /\.brand-logo\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, "no .brand-logo rule");
  const body = rule[1] ?? "";
  assert.match(body, /width:\s*auto/, "a fixed width would distort the mark");
  assert.match(body, /object-fit:\s*contain/);
  assert.doesNotMatch(body, /\bfilter\s*:/, "a filter would recolour the official mark");
  assert.doesNotMatch(body, /opacity\s*:/, "fading the mark is a recolour");
  // The mark must stay readable and bounded on a narrow viewport.
  assert.match(body, /max-width:\s*\d+vw/);

  const link = /\.brand\s*\{([^}]*)\}/.exec(css);
  assert.ok(link, "no .brand rule");
  assert.match(link[1] ?? "", /text-decoration:\s*none/);
});

test("the mark is delivered same-origin, which is all the production CSP allows", () => {
  // img-src 'self' data: — a CDN or any absolute origin would be blocked in
  // production while still rendering fine in a unit test.
  assert.equal(BRAND_LOGO_SRC.startsWith("./"), true);
  assert.doesNotMatch(BRAND_LOGO_SRC, /^[a-z]+:|^\/\//i);
  const html = renderedShell();
  const sources = [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1] ?? "");
  for (const src of sources) {
    assert.doesNotMatch(src, /^https?:|^\/\//i, `off-origin image source ${src}`);
  }
});
