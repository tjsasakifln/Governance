#!/usr/bin/env node
/**
 * In-image HTTP probe. Uses Node's fetch — no wget/curl/apt chain.
 */
const base = (process.argv[2] ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const paths = process.argv.slice(3);
const targets = paths.length > 0 ? paths : ["/healthz", "/ready"];

for (const path of targets) {
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    process.stderr.write(`${url} error=${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  if (!res.ok) {
    process.stderr.write(`${url} status=${res.status}\n`);
    process.exit(1);
  }
  const body = await res.text();
  if (!body.trim()) {
    process.stderr.write(`${url} empty body\n`);
    process.exit(1);
  }
}
