#!/usr/bin/env node
/**
 * Builder-only: point workspace package.json exports at compiled dist/*.js
 * so Node can load them without tsx. Local source exports stay in git.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ? process.argv[2] : join(dirname(fileURLToPath(import.meta.url)), "..");

function toDist(spec) {
  if (typeof spec !== "string") return spec;
  if (spec.startsWith("./dist/") && spec.endsWith(".js")) return spec;
  if (spec.endsWith(".ts")) {
    return spec.replace(/^\.\//, "./").replace(/\/src\//, "/dist/").replace(/^\.\/src\//, "./dist/").replace(/\.ts$/, ".js");
  }
  return spec;
}

function rewriteExports(exportsField) {
  if (typeof exportsField === "string") {
    return toDist(exportsField);
  }
  if (Array.isArray(exportsField)) {
    return exportsField.map(rewriteExports);
  }
  if (exportsField && typeof exportsField === "object") {
    const next = {};
    for (const [key, value] of Object.entries(exportsField)) {
      if (key === "types") {
        next[key] = value;
        continue;
      }
      next[key] = rewriteExports(value);
    }
    return next;
  }
  return exportsField;
}

function rewritePkg(pkgPath) {
  if (!existsSync(pkgPath)) return false;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  let changed = false;
  if (typeof pkg.main === "string" && pkg.main.endsWith(".ts")) {
    pkg.main = toDist(pkg.main);
    changed = true;
  }
  if (typeof pkg.types === "string" && pkg.types.endsWith(".ts")) {
    pkg.types = pkg.types.replace(/\/src\//, "/dist/").replace(/^\.\/src\//, "./dist/").replace(/\.ts$/, ".d.ts");
    changed = true;
  }
  if (pkg.exports) {
    pkg.exports = rewriteExports(pkg.exports);
    changed = true;
  }
  if (pkg.bin && typeof pkg.bin === "object") {
    for (const [name, spec] of Object.entries(pkg.bin)) {
      if (typeof spec === "string" && spec.endsWith(".ts")) {
        pkg.bin[name] = toDist(spec);
        changed = true;
      }
    }
  } else if (typeof pkg.bin === "string" && pkg.bin.endsWith(".ts")) {
    pkg.bin = toDist(pkg.bin);
    changed = true;
  }
  if (changed) {
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  return changed;
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : [];
const rewritten = [];
for (const ws of workspaces) {
  const pkgPath = join(root, ws, "package.json");
  if (rewritePkg(pkgPath)) {
    rewritten.push(ws);
  }
}
process.stdout.write(`${JSON.stringify({ ok: true, rewritten }, null, 2)}\n`);
