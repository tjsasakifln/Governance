import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("page artifact uses a classic script and documents file: serving", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /<script src="\.\/dist\/app\.js"><\/script>/);
  assert.doesNotMatch(html, /<script type="module"/);
  assert.match(html, /file:/);
  assert.match(html, /npm start/);
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(html, /password=/i);
});

test("built IIFE runs with window and without Node require", () => {
  const bundlePath = path.join(root, "dist/app.js");
  assert.equal(fs.existsSync(bundlePath), true, "dist/app.js must exist after npm run build");
  const code = fs.readFileSync(bundlePath, "utf8");
  assert.doesNotMatch(code, /\brequire\s*\(/);
  assert.doesNotMatch(code, /module\.exports/);
  assert.doesNotMatch(code, /process\.env\.(PASSWORD|SECRET|TOKEN|DATABASE_URL)/);
  assert.doesNotMatch(code, /password\s*[:=]/i);

  const listeners = new Map<string, Array<(ev: { type: string }) => void>>();
  const app = {
    innerHTML: "",
    id: "app",
    attributes: new Map<string, string>(),
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    },
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null;
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  const document = {
    getElementById(id: string) {
      return id === "app" ? app : null;
    },
    querySelector(sel: string) {
      if (typeof sel === "string" && sel.startsWith("meta[name=")) {
        const name = sel.slice('meta[name="'.length, -2);
        const content: Record<string, string> = {
          "cc-founder-actor-id": "human:founder",
          "cc-actor-id": "human:founder",
          "cc-actor-role": "founder",
          "cc-use-mock-identity": "1",
        };
        return {
          getAttribute(attr: string) {
            return attr === "content" ? content[name] ?? "" : null;
          },
        };
      }
      if (sel.includes("dist/app.js")) return { src: "./dist/app.js" };
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type: string, fn: (ev: { type: string }) => void) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    readyState: "complete",
    body: { insertBefore() {} },
  };

  const window = {
    document,
    location: { protocol: "http:" },
    addEventListener() {},
    __CC_DIRECTIVES_UI__: undefined as { mounted: boolean } | undefined,
  };

  const sandbox = {
    window,
    document,
    location: window.location,
    setTimeout,
    clearTimeout,
    Intl,
    Date,
    console,
  };
  vm.runInNewContext(code, sandbox, { filename: "dist/app.js" });
  assert.equal(window.__CC_DIRECTIVES_UI__?.mounted, true);
  assert.ok(app.innerHTML.length > 400, "mounted surface must be substantially filled");
  assert.match(app.innerHTML, /Memória estratégica/);
  assert.match(app.innerHTML, /filter-kind/);
});
