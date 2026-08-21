#!/usr/bin/env node
/**
 * Fail the web image build if production dist contains sourcemaps or env-looking secrets.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2];
if (!dist || !existsSync(dist)) {
  process.stderr.write("assert-web-bundle: dist directory missing\n");
  process.exit(1);
}

const SECRET =
  /(?:AWS_SECRET|SECRET_ACCESS_KEY|PRIVATE_KEY|BEGIN RSA PRIVATE|BEGIN OPENSSH|POSTGRES_PASSWORD|CONTROL_CENTER_BACKUP_KEY|CONFENGE_MCP_AUTH_TOKEN)\s*[:=]/i;

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      walk(path, files);
    } else {
      files.push(path);
    }
  }
  return files;
}

const files = walk(dist);
const maps = files.filter((f) => f.endsWith(".map"));
if (maps.length > 0) {
  process.stderr.write(`production sourcemap present: ${maps.join(", ")}\n`);
  process.exit(1);
}

for (const file of files) {
  if (!/\.(js|html|css|json|webmanifest)$/.test(file)) continue;
  const body = readFileSync(file, "utf8");
  if (SECRET.test(body)) {
    process.stderr.write(`possible secret in bundle: ${file}\n`);
    process.exit(1);
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, files: files.length, maps: 0 })}\n`);
