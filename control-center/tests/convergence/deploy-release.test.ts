import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const OVERLAY = join(import.meta.dirname, "..", "..", "deploy", "overlays", "production-edge");
const COMPOSE = readFileSync(join(OVERLAY, "docker-compose.production-edge.yml"), "utf8");
const DEPLOY = readFileSync(join(OVERLAY, "deploy-release.sh"), "utf8");

/** Services whose image tag interpolates the release SHA, read from compose itself. */
function releaseStampedServices(): string[] {
  const names = new Set<string>();
  for (const line of COMPOSE.split("\n")) {
    const match = /^\s*image:\s*confenge-control-center-([a-z0-9-]+):\$\{CC_RELEASE_SHA/.exec(line);
    if (match) names.add(match[1]);
  }
  return [...names].sort();
}

function declaredReleaseServices(): string[] {
  const match = /RELEASE_SERVICES=\(([^)]*)\)/.exec(DEPLOY);
  assert.ok(match, "deploy-release.sh must declare RELEASE_SERVICES");
  return match[1].trim().split(/\s+/).filter(Boolean).sort();
}

test("every release-stamped service is rebuilt by the rollout", () => {
  // The previous, unversioned host script rebuilt context, mcp and web only.
  // The collector is built from this same repository and carries the release SHA
  // in its tag, so a merged connectors/warmbly change stayed unshipped while
  // every health check reported green.
  assert.deepEqual(declaredReleaseServices(), releaseStampedServices());
});

test("the collector is not forgotten", () => {
  assert.ok(releaseStampedServices().includes("collector"));
  assert.ok(declaredReleaseServices().includes("collector"));
});

test("provenance is checked for every rebuilt service, not a subset", () => {
  assert.match(DEPLOY, /verify-release\.sh "\$CC_RELEASE_SHA" "\$\{RELEASE_SERVICES\[@\]\}"/);
});

test("a dirty checkout is refused before anything is built", () => {
  const dirtyGuard = DEPLOY.indexOf("git status --porcelain");
  const firstBuild = DEPLOY.indexOf("$COMPOSE build");
  assert.ok(dirtyGuard > 0, "the rollout must inspect the checkout");
  assert.ok(dirtyGuard < firstBuild, "the dirty-checkout guard must run before the build");
});

test("the rollout pins an exact commit and never a floating branch", () => {
  assert.match(DEPLOY, /\[\[ "\$TARGET_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(DEPLOY, /git checkout --quiet -B main "\$TARGET_SHA"/);
});
