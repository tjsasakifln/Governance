#!/usr/bin/env node
/**
 * Builder-only: drop TypeScript sources, maps, tsx/esbuild/typescript, tests.
 * Leaves dist, production node_modules, and declared data files.
 */
import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
if (!root) {
  process.stderr.write("usage: node strip-runtime-tree.mjs <root> [keepDir...]\n");
  process.exit(1);
}

const DROP_DIR_NAMES = new Set([
  "src",
  "tests",
  "test",
  "docs",
  ".git",
  ".github",
  "coverage",
]);

const DROP_PACKAGES = [
  "tsx",
  "esbuild",
  "typescript",
  "vite",
  "@types",
  "@esbuild",
  "embedded-postgres",
  "@embedded-postgres",
];

function rm(path) {
  rmSync(path, { recursive: true, force: true });
}

function walkDropMapsAndTs(dir, insideNodeModules) {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        walkDropMapsAndTs(path, true);
        continue;
      }
      if (!insideNodeModules && DROP_DIR_NAMES.has(entry.name)) {
        rm(path);
        continue;
      }
      walkDropMapsAndTs(path, insideNodeModules);
      continue;
    }
    if (entry.isFile()) {
      if (entry.name.endsWith(".map")) {
        rm(path);
        continue;
      }
      if (!insideNodeModules && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        rm(path);
      }
    }
  }
}

walkDropMapsAndTs(root, false);

function dropPackage(base, name) {
  const target = join(base, name);
  if (existsSync(target)) {
    rm(target);
  }
}

function scrubBin(nm) {
  const bin = join(nm, ".bin");
  if (!existsSync(bin) || !lstatSync(bin).isDirectory()) return;
  let names;
  try {
    names = readdirSync(bin);
  } catch {
    return;
  }
  for (const name of names) {
    if (/^(tsx|esbuild|tsc|tsserver|vite|playwright)(?:\.cmd|\.ps1)?$/.test(name)) {
      rm(join(bin, name));
    }
  }
}

function scrubNodeModules(nm) {
  if (!existsSync(nm) || !lstatSync(nm).isDirectory()) return;
  scrubBin(nm);
  for (const pkg of DROP_PACKAGES) {
    dropPackage(nm, pkg);
  }
  let entries;
  try {
    entries = readdirSync(nm, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("@")) {
      const scope = join(nm, entry.name);
      for (const pkg of DROP_PACKAGES) {
        if (pkg.startsWith(`${entry.name}/`) || pkg === entry.name) {
          dropPackage(nm, pkg);
        }
      }
      if (entry.name === "@esbuild" || entry.name === "@types" || entry.name === "@embedded-postgres") {
        rm(scope);
        continue;
      }
      scrubNodeModules(scope);
    }
    if (entry.name === "node_modules") {
      scrubNodeModules(join(nm, entry.name));
    }
  }
}

function findNodeModules(dir, depth = 0) {
  if (depth > 6 || !existsSync(dir)) return;
  const nm = join(dir, "node_modules");
  if (existsSync(nm)) {
    scrubNodeModules(nm);
  }
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    findNodeModules(join(dir, entry.name), depth + 1);
  }
}

findNodeModules(root);
process.stdout.write(`${JSON.stringify({ ok: true, root })}\n`);
