import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const BUNDLE_FILES = {
  caddyfile: "Caddyfile",
  compose: "compose.yaml",
  policy: "policy.json",
  health: "health-response.json",
  authelia: path.join("authelia", "configuration.yml"),
  users: path.join("authelia", "users.yml"),
} as const;

export interface SecurityBundle {
  readonly dir: string;
  readonly files: Readonly<Record<keyof typeof BUNDLE_FILES, string>>;
  readonly extraTextFiles: readonly { readonly path: string; readonly text: string }[];
}

function readRequired(dir: string, rel: string): string {
  const full = path.join(dir, rel);
  if (!existsSync(full)) {
    throw new Error(`bundle missing ${rel}`);
  }
  return readFileSync(full, "utf8");
}

function walkFiles(dir: string, rel = ""): string[] {
  const here = rel ? path.join(dir, rel) : dir;
  const names = readdirSync(here);
  const out: string[] = [];
  for (const name of names) {
    if (name === "node_modules" || name === "dist") {
      continue;
    }
    const childRel = rel ? path.join(rel, name) : name;
    const full = path.join(dir, childRel);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkFiles(dir, childRel));
    } else {
      out.push(childRel);
    }
  }
  return out;
}

const TEXT_EXT = new Set([".yml", ".yaml", ".json", ".env", ".example", ".md", ""]);

export function loadBundle(dir: string): SecurityBundle {
  const files = {
    caddyfile: readRequired(dir, BUNDLE_FILES.caddyfile),
    compose: readRequired(dir, BUNDLE_FILES.compose),
    policy: readRequired(dir, BUNDLE_FILES.policy),
    health: readRequired(dir, BUNDLE_FILES.health),
    authelia: readRequired(dir, BUNDLE_FILES.authelia),
    users: readRequired(dir, BUNDLE_FILES.users),
  };
  const extraTextFiles: { path: string; text: string }[] = [];
  for (const rel of walkFiles(dir)) {
    const ext = path.extname(rel).toLowerCase();
    const base = path.basename(rel);
    if (base === "Caddyfile" || TEXT_EXT.has(ext) || base.endsWith(".example")) {
      extraTextFiles.push({ path: rel, text: readFileSync(path.join(dir, rel), "utf8") });
    }
  }
  return { dir, files, extraTextFiles };
}
