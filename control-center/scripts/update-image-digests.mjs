#!/usr/bin/env node
/**
 * Re-resolve image tags to current index digests and rewrite pins.
 * Never writes "latest". Does not edit security/examples overlay files.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pinPath = join(root, "supply-chain/image-pins.json");

const REWRITE_GLOBS = [
  join(root, "services/context/Dockerfile"),
  join(root, "services/mcp/Dockerfile"),
  join(root, "connectors/runner/Dockerfile"),
  join(root, "apps/web-shell/Dockerfile"),
  join(root, "deploy/docker/ops.Dockerfile"),
  join(root, "deploy/docker/postgres.Dockerfile"),
  join(root, "deploy/docker/caddy.Dockerfile"),
  join(root, "deploy/docker/stub.Dockerfile"),
  join(root, "deploy/docker-compose.yml"),
  join(root, "deploy/overlays/production-edge/docker-compose.production-edge.yml"),
  join(root, "security/production/compose.yaml"),
  join(root, "supply-chain/image-pins.json"),
];

function inspectDigest(name, tag) {
  const image = `${name}:${tag}`;
  if (tag === "latest") {
    throw new Error(`refusing to resolve floating tag: ${image}`);
  }
  const out = execFileSync(
    "docker",
    ["buildx", "imagetools", "inspect", image, "--format", "{{.Manifest.Digest}}"],
    { encoding: "utf8" },
  ).trim();
  if (!/^sha256:[0-9a-f]{64}$/.test(out)) {
    throw new Error(`inspect of ${image} did not return a sha256 digest: ${out}`);
  }
  return out;
}

const pins = JSON.parse(readFileSync(pinPath, "utf8"));
const replacements = [];
for (const [key, pin] of Object.entries(pins.images)) {
  const digest = inspectDigest(pin.name, pin.tag);
  const ref = `${pin.name}:${pin.tag}@${digest}`;
  if (pin.digest !== digest) {
    replacements.push({ key, from: pin.digest, to: digest, ref });
  }
  pin.digest = digest;
  pin.ref = ref;
  pins.images[key] = pin;
}
pins.updated_at = new Date().toISOString();
writeFileSync(pinPath, `${JSON.stringify(pins, null, 2)}\n`);

for (const file of REWRITE_GLOBS) {
  let text = readFileSync(file, "utf8");
  for (const pin of Object.values(pins.images)) {
    const unpinned = `${pin.name}:${pin.tag}`;
    const pinned = pin.ref;
    text = text.replaceAll(`${unpinned}@sha256:${"x".repeat(64)}`, pinned);
    const re = new RegExp(
      `${unpinned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@sha256:[0-9a-f]{64}`,
      "g",
    );
    text = text.replace(re, pinned);
  }
  writeFileSync(file, text);
}

process.stdout.write(
  `${JSON.stringify({ ok: true, updated: replacements, pins: Object.fromEntries(Object.entries(pins.images).map(([k, v]) => [k, v.ref])) }, null, 2)}\n`,
);
