import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

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

  assert.match(context, /"tsx", "src\/server\.ts"/);
  assert.match(mcp, /"tsx", "src\/index\.ts"/);
  assert.match(collector, /"tsx", "src\/server\.ts"/);
  assert.match(web, /serve-prod\.mjs/);
  assert.match(postgres, /postgres:16/);
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

test("web-shell Vite aliases exact-match contract subpaths, not index.ts prefix", () => {
  const vite = readFileSync(join(root, "apps/web-shell/vite.config.ts"), "utf8");
  assert.match(vite, /find:\s*\/\^@confenge\\\/control-center-contracts\\\/taxonomy\$\//);
  assert.match(vite, /find:\s*\/\^@confenge\\\/control-center-contracts\\\/types\$\//);
  assert.doesNotMatch(
    vite,
    /"@confenge\/control-center-contracts":\s*path\.resolve\(here,\s*"\.\.\/\.\.\/contracts\/src\/index\.ts"\)/,
  );
});
