import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseExceptionFile, evaluateExceptions } from "../../supply-chain/cve-policy.ts";
import { loadImagePins, requiredRoles } from "../../supply-chain/image-pins.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = join(root, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function lastStage(dockerfile: string): string {
  const parts = dockerfile.split(/^FROM /m);
  assert.ok(parts.length >= 2, "dockerfile must have at least one FROM");
  return `FROM ${parts[parts.length - 1]}`;
}

function builderStages(dockerfile: string): string {
  const parts = dockerfile.split(/^FROM /m);
  return parts
    .slice(1, -1)
    .map((p) => `FROM ${p}`)
    .join("\n");
}

const NODE_PIN = /node:22-bookworm-slim@sha256:[0-9a-f]{64}/;
const SHA_PIN = /@sha256:[0-9a-f]{64}/;
const RUNTIME_NODE_CMD = /CMD\s*\[(?:[^\]]*"node"[^\]]*)\]|ENTRYPOINT\s*\[(?:[^\]]*"node"[^\]]*)\]/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("runtime Dockerfiles are real images, not the deploy stub", () => {
  const files = {
    context: join(root, "services/context/Dockerfile"),
    mcp: join(root, "services/mcp/Dockerfile"),
    collector: join(root, "connectors/runner/Dockerfile"),
    web: join(root, "apps/web-shell/Dockerfile"),
    postgres: join(root, "deploy/docker/postgres.Dockerfile"),
    compose: join(root, "deploy/docker-compose.yml"),
  };
  const context = readFileSync(files.context, "utf8");
  const mcp = readFileSync(files.mcp, "utf8");
  const collector = readFileSync(files.collector, "utf8");
  const web = readFileSync(files.web, "utf8");
  const postgres = readFileSync(files.postgres, "utf8");
  const compose = readFileSync(files.compose, "utf8");

  assert.match(lastStage(context), /"node"/);
  assert.match(lastStage(mcp), /"node"/);
  assert.match(lastStage(collector), /"node"/);
  assert.match(web, /serve-prod\.mjs/);
  assert.match(postgres, /postgres:16-alpine@sha256:[0-9a-f]{64}/);
  assert.doesNotMatch(context, /stub-health-server/);
  assert.doesNotMatch(mcp, /stub-health-server/);
  assert.doesNotMatch(collector, /stub-health-server/);
  assert.doesNotMatch(web, /stub-health-server/);
  assert.doesNotMatch(compose, /docker\/stub\.Dockerfile/);
  assert.match(compose, /services\/context\/Dockerfile/);
  assert.match(compose, /services\/mcp\/Dockerfile/);
  assert.match(compose, /connectors\/runner\/Dockerfile/);
  assert.match(compose, /apps\/web-shell\/Dockerfile/);
});

test("CI installs Playwright OS deps including libnspr4 without Ubuntu 22 libasound2", () => {
  const workflow = readFileSync(join(root, "../.github/workflows/control-center.yml"), "utf8");
  assert.match(workflow, /libnspr4/);
  assert.match(workflow, /playwright@1\.55\.0 install-deps chromium/);
  assert.doesNotMatch(workflow, /libasound2(?:\s|$)/);
  assert.match(workflow, /context_risks=\[1-9\]/);
  assert.match(workflow, /nav_changed_to=comercial/);
  assert.match(workflow, /launch-probe ok/);
});

test("web-shell Vite aliases exact-match contract subpaths, not index.ts prefix", () => {
  const vite = readFileSync(join(root, "apps/web-shell/vite.config.ts"), "utf8");
  assert.match(vite, /find:\s*\/\^@confenge\\\/control-center-contracts\\\/taxonomy\$\//);
  assert.match(vite, /find:\s*\/\^@confenge\\\/control-center-contracts\\\/types\$\//);
  assert.doesNotMatch(
    vite,
    /"@confenge\/control-center-contracts":\s*path\.resolve\(here,\s*"\.\.\/\.\.\/contracts\/src\/index\.ts"\)/,
  );
});

test("Node images are a single major (Node 22) with pinned builder compile and node JS runtime", () => {
  const nodeFiles = [
    "services/context/Dockerfile",
    "services/mcp/Dockerfile",
    "connectors/runner/Dockerfile",
    "apps/web-shell/Dockerfile",
    "deploy/docker/ops.Dockerfile",
    "deploy/docker/stub.Dockerfile",
  ];
  for (const rel of nodeFiles) {
    const text = read(rel);
    assert.doesNotMatch(text, /node:20/);
    assert.match(text, NODE_PIN);
    const runtime = lastStage(text);
    assert.match(runtime, RUNTIME_NODE_CMD, `${rel} runtime must start node, not npx/tsx`);
    assert.doesNotMatch(runtime, /CMD\s*\[[^\]]*(?:npx|tsx)/);
    assert.doesNotMatch(runtime, /ENTRYPOINT\s*\[[^\]]*(?:npx|tsx)/);
    assert.doesNotMatch(runtime, /tsx@/);
    assert.doesNotMatch(runtime, /esbuild/);
    assert.doesNotMatch(runtime, /npm (?:ci|install)/);
    assert.match(runtime, /rm -f \/usr\/local\/bin\/npm \/usr\/local\/bin\/npx/);
    assert.match(runtime, /USER (?:node|nonroot)/);
    assert.match(runtime, /NODE_ENV=production/);
    assert.doesNotMatch(runtime, /\.map/);
    if (rel !== "deploy/docker/stub.Dockerfile") {
      assert.match(text, /AS builder/);
      const builder = builderStages(text);
      assert.match(builder.length > 0 ? builder : text, /npm ci/);
      assert.match(text, /--ignore-scripts/);
    }
  }
  const context = lastStage(read("services/context/Dockerfile"));
  const mcp = lastStage(read("services/mcp/Dockerfile"));
  const collector = lastStage(read("connectors/runner/Dockerfile"));
  assert.match(context, /dist\/server\.js/);
  assert.match(mcp, /dist\/index\.js/);
  assert.match(collector, /dist\/server\.js/);
  assert.doesNotMatch(context, /src\/server\.ts/);
  assert.doesNotMatch(mcp, /src\/index\.ts/);
  assert.doesNotMatch(collector, /src\/server\.ts/);
});

test("ops install uses --ignore-scripts and compiled node entry, no startup npm install", () => {
  const ops = read("deploy/docker/ops.Dockerfile");
  assert.match(ops, /npm ci --ignore-scripts/);
  assert.match(lastStage(ops), /ENTRYPOINT \["node", "dist\/cli\.js"\]/);
  assert.doesNotMatch(lastStage(ops), /ENTRYPOINT\s*\[[^\]]*(?:npx|tsx)/);
  assert.doesNotMatch(ops, /npm install/);
  assert.match(lastStage(ops), /rm -f \/usr\/local\/bin\/npm \/usr\/local\/bin\/npx/);
});

test("production web sourcemap is false and serve-prod sets a script CSP without unsafe-eval", () => {
  const vite = read("apps/web-shell/vite.config.ts");
  assert.match(vite, /sourcemap:\s*false/);
  const serve = read("apps/web-shell/scripts/serve-prod.mjs");
  assert.match(serve, /Content-Security-Policy/);
  assert.doesNotMatch(serve, /unsafe-eval/);
  assert.doesNotMatch(serve, /script-src[^;]*unsafe-inline/);
});

test("productive FROM and compose image refs are digest-pinned and match the pin lock", () => {
  const pins = loadImagePins(join(root, "supply-chain/image-pins.json"));
  requiredRoles(pins, [
    "node-builder-runtime",
    "postgres",
    "authelia",
    "caddy-base",
    "caddy-overlay-scan",
    "redis-overlay-scan",
  ]);
  for (const pin of Object.values(pins.images)) {
    assert.notEqual(pin.tag, "latest");
    assert.match(pin.digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(pin.ref, `${pin.name}:${pin.tag}@${pin.digest}`);
  }
  const nodeRef = pins.images["node-22-bookworm-slim"]?.ref;
  const pgRef = pins.images["postgres-16-alpine"]?.ref;
  const autheliaRef = pins.images["authelia-4.39"]?.ref;
  const caddyRef = pins.images["caddy-2.8-alpine"]?.ref;
  const redisRef = pins.images["redis-7-alpine"]?.ref;
  assert.ok(nodeRef && pgRef && autheliaRef && caddyRef && redisRef);

  const dockerfiles = [
    "services/context/Dockerfile",
    "services/mcp/Dockerfile",
    "connectors/runner/Dockerfile",
    "apps/web-shell/Dockerfile",
    "deploy/docker/ops.Dockerfile",
    "deploy/docker/postgres.Dockerfile",
    "deploy/docker/caddy.Dockerfile",
  ];
  for (const rel of dockerfiles) {
    const text = read(rel);
    assert.match(text, SHA_PIN, `${rel} must pin by digest`);
    assert.doesNotMatch(text, /FROM\s+\S+:latest(?:\s|$)/);
  }
  assert.match(read("services/context/Dockerfile"), new RegExp(escapeRegExp(nodeRef)));
  assert.match(read("deploy/docker/postgres.Dockerfile"), new RegExp(escapeRegExp(pgRef)));
  assert.match(read("deploy/docker/caddy.Dockerfile"), new RegExp(escapeRegExp(caddyRef)));

  const compose = read("deploy/docker-compose.yml");
  assert.match(compose, new RegExp(escapeRegExp(autheliaRef)));
  assert.doesNotMatch(compose, /image:\s+\S+:latest(?:\s|$)/);

  const overlay = read("security/examples/valid/compose.yaml");
  assert.match(overlay, /redis:7-alpine/);
  assert.match(overlay, /caddy:2\.9-alpine/);
  assert.ok(redisRef.includes("redis:7-alpine@sha256:"));
  assert.ok(pins.images["caddy-2.9-alpine"]?.ref.includes("caddy:2.9-alpine@sha256:"));
});

test("CVE exception records require owner, expiry, evidence, reachability, mitigation; expired fail", () => {
  const shipped = parseExceptionFile(JSON.parse(read("supply-chain/cve-exceptions.json")));
  assert.equal(shipped.schema_version, "control-center.cve-exceptions.v1");
  const live = evaluateExceptions(shipped, { now: new Date("2026-08-21T00:00:00Z") });
  assert.equal(live.ok, true, live.failures.map((f) => f.message).join("; "));

  const expired = evaluateExceptions(
    parseExceptionFile({
      schema_version: "control-center.cve-exceptions.v1",
      exceptions: [
        {
          id: "EXP-1",
          cve: "CVE-2020-0001",
          package: "example",
          image: "node",
          severity: "HIGH",
          reachable: false,
          fix_available: false,
          mitigation: "not imported in runtime",
          owner: "control-center",
          expiry: "2020-01-01",
          evidence: "tests/fixtures",
        },
      ],
    }),
    { now: new Date("2026-08-21T00:00:00Z") },
  );
  assert.equal(expired.ok, false);
  assert.equal(expired.failures.some((f) => f.code === "expired_exception"), true);

  const reachableHighFix = evaluateExceptions(
    parseExceptionFile({
      schema_version: "control-center.cve-exceptions.v1",
      exceptions: [
        {
          id: "HIGH-FIX",
          cve: "CVE-2024-0001",
          package: "leftpad",
          image: "node",
          severity: "HIGH",
          reachable: true,
          fix_available: true,
          mitigation: "none",
          owner: "control-center",
          expiry: "2027-01-01",
          evidence: "n/a",
        },
      ],
    }),
    { now: new Date("2026-08-21T00:00:00Z") },
  );
  assert.equal(reachableHighFix.ok, false);
  assert.equal(reachableHighFix.failures.some((f) => f.code === "reachable_high_fix_ignored"), true);
});

test("SBOM/image-scan workflow covers every image, CycloneDX and SPDX, and does not delete Trivy", () => {
  const wfPath = join(repoRoot, ".github/workflows/control-center-image-scan.yml");
  assert.equal(existsSync(wfPath), true);
  const wf = readFileSync(wfPath, "utf8");
  for (const name of [
    "context",
    "mcp",
    "collector",
    "web",
    "ops",
    "authelia",
    "caddy",
    "postgres",
    "redis",
  ]) {
    assert.match(wf, new RegExp(name), `workflow must scan ${name}`);
  }
  assert.match(wf, /cyclonedx/i);
  assert.match(wf, /spdx/i);
  assert.match(wf, /trivy/i);
  assert.match(wf, /npm audit/);
  assert.match(wf, /secret/);
  assert.match(wf, /license/i);
  assert.match(wf, /GITHUB_SHA|github\.sha/);
  assert.match(wf, /upload-artifact/);
  assert.match(wf, /image-scan-gate/);
  assert.doesNotMatch(wf, /rm\s+-rf.*trivy/i);
  assert.doesNotMatch(wf, /git add.*sbom/i);
});
