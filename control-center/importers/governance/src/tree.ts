import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import type { VirtualSourceFile } from "./types.js";

export const DEFAULT_RELATIVE_ROOTS = ["decisions", "commercial"] as const;

const SKIP_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "dist",
  ".venv",
  "__pycache__",
]);

const SECRET_NAME =
  /^(?:\.env(?:\..+)?|.*\.(?:pem|p12|pfx|key)|id_rsa|id_ed25519|credentials|secret)$/i;

const PARTNER_PROGRAM = /(^|\/)partner-program(\/|$)|partner-program/i;

export type ScannedFile = {
  path: string;
  bytes: Uint8Array;
  skipReason?: string;
};

export function toPosixPath(value: string): string {
  return value.split(sep).join(posix.sep);
}

export function isDeniedPath(sourcePath: string): string | null {
  const posixPath = toPosixPath(sourcePath);
  const segments = posixPath.split("/");
  for (const segment of segments) {
    if (SKIP_SEGMENTS.has(segment)) {
      return `skipped_segment:${segment}`;
    }
    if (SECRET_NAME.test(segment)) {
      return "secret_filename";
    }
  }
  if (PARTNER_PROGRAM.test(posixPath)) {
    return "out_of_scope_partner_program";
  }
  if (posixPath.includes("..")) {
    return "path_escape";
  }
  return null;
}

export function walkDisk(root: string, relativeRoots: readonly string[]): ScannedFile[] {
  const files: ScannedFile[] = [];
  for (const relativeRoot of relativeRoots) {
    const abs = join(root, relativeRoot);
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(abs);
    } catch {
      continue;
    }
    if (!stats.isDirectory() && !stats.isFile()) {
      continue;
    }
    if (stats.isFile()) {
      collectFile(root, abs, files);
      continue;
    }
    walkDir(root, abs, files);
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

export function fromVirtual(files: readonly VirtualSourceFile[]): ScannedFile[] {
  const out: ScannedFile[] = [];
  for (const file of files) {
    const path = toPosixPath(file.path).replace(/^\/+/, "");
    const denied = isDeniedPath(path);
    if (denied) {
      out.push({ path, bytes: new Uint8Array(), skipReason: denied });
      continue;
    }
    out.push({ path, bytes: file.bytes });
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

function walkDir(root: string, dir: string, files: ScannedFile[]): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = toPosixPath(relative(root, abs));
    const denied = isDeniedPath(rel);
    if (denied) {
      if (!denied.startsWith("skipped_segment:")) {
        files.push({ path: rel, bytes: new Uint8Array(), skipReason: denied });
      }
      continue;
    }
    if (entry.isDirectory()) {
      walkDir(root, abs, files);
      continue;
    }
    if (entry.isFile()) {
      collectFile(root, abs, files);
    }
  }
}

function collectFile(root: string, abs: string, files: ScannedFile[]): void {
  const rel = toPosixPath(relative(root, abs));
  const denied = isDeniedPath(rel);
  if (denied) {
    if (!denied.startsWith("skipped_segment:")) {
      files.push({ path: rel, bytes: new Uint8Array(), skipReason: denied });
    }
    return;
  }
  const bytes = new Uint8Array(readFileSync(abs));
  files.push({ path: rel, bytes });
}

export function scopeFromPath(sourcePath: string): string {
  const posixPath = toPosixPath(sourcePath);
  if (posixPath === "commercial" || posixPath.startsWith("commercial/")) {
    return "commercial";
  }
  if (posixPath === "finance" || posixPath.startsWith("finance/")) {
    return "finance";
  }
  return "company";
}
