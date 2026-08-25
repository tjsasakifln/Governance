import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  applyFileProtocolGuard,
  FILE_PROTOCOL_DEV,
  FILE_PROTOCOL_PREVIEW,
  installShellGlobals,
  isFileProtocol,
  resolveBrowserAdapter,
  startBrowser,
  type ShellWindow,
} from "../src/boot";
import { DESTINATION_IDS, PRIMARY_SURFACE } from "../src/destinations";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "../src");
const rootDir = join(srcDir, "..");

test("browser entry has no unguarded Node require/module.exports", () => {
  const main = readFileSync(join(srcDir, "main.ts"), "utf8");
  const boot = readFileSync(join(srcDir, "boot.ts"), "utf8");
  const html = readFileSync(join(rootDir, "index.html"), "utf8");
  for (const src of [main, boot]) {
    assert.doesNotMatch(src, /\brequire\s*\(/);
    assert.doesNotMatch(src, /module\.exports/);
    assert.doesNotMatch(src, /\bexports\./);
  }
  assert.match(html, /file-protocol-guard\.js/);
  const guard = readFileSync(join(rootDir, "public/file-protocol-guard.js"), "utf8");
  assert.match(guard, /location\.protocol !== "file:"|location\.protocol === "file:"/);
  assert.match(guard, /npm run dev/);
  assert.match(guard, /npm run preview/);
});

test("installShellGlobals exposes destinations and mount on window", () => {
  const win: ShellWindow = { location: { protocol: "http:" } };
  const globals = installShellGlobals(win);
  assert.equal(globals.version.length > 0, true);
  assert.deepEqual([...globals.destinations], [...DESTINATION_IDS]);
  assert.equal(globals.primarySurface, PRIMARY_SURFACE);
  assert.equal(typeof globals.mount, "function");
  assert.equal(win.__CONFENGE_CONTROL_CENTER__, globals);
});

test("file: protocol is detected and shows how to run the shell", () => {
  assert.equal(isFileProtocol("file:"), true);
  assert.equal(isFileProtocol("http:"), false);
  const root = { innerHTML: "" };
  const blocked = applyFileProtocolGuard({ protocol: "file:" }, root);
  assert.equal(blocked, true);
  assert.match(root.innerHTML, /file:/);
  assert.ok(root.innerHTML.includes(FILE_PROTOCOL_DEV));
  assert.ok(root.innerHTML.includes(FILE_PROTOCOL_PREVIEW));
  const httpRoot = { innerHTML: "" };
  assert.equal(applyFileProtocolGuard({ protocol: "http:" }, httpRoot), false);
  assert.equal(httpRoot.innerHTML, "");
});

test("startBrowser is a no-op without window (safe Node import) and mounts when window exists", () => {
  startBrowser(undefined, undefined);
  const root = { innerHTML: "" };
  const win: ShellWindow = { location: { protocol: "file:" } };
  startBrowser(win, { getElementById: (id: string) => (id === "root" ? root : null) });
  assert.match(root.innerHTML, /npm run dev/);
  assert.ok(win.__CONFENGE_CONTROL_CENTER__);
});

test("production boot keeps fixture catalog out of its eager path", async () => {
  const adapter = await resolveBrowserAdapter(undefined, undefined);
  assert.equal(adapter.mode, "http");
  const mock = await resolveBrowserAdapter(undefined, {
    querySelector: () => ({ getAttribute: () => "1" }),
  });
  assert.equal(mock.mode, "mock");
  const boot = readFileSync(join(srcDir, "boot.ts"), "utf8");
  assert.doesNotMatch(boot, /^import .*adapters\/mock/m);
  assert.match(boot, /import\("\.\/adapters\/mock"\)/);
});
