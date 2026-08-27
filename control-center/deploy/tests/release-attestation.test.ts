import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { PACK_ROOT } from "../src/paths.ts";

const SCRIPT = join(PACK_ROOT, "overlays", "production-edge", "verify-release.sh");
const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function composeConfig(sha: string): string {
  const services = Object.fromEntries(
    ["collector", "context", "mcp", "web"].map((service) => [
      service,
      {
        image: `confenge-control-center-${service}:${sha}`,
        build: {
          labels: {
            "br.com.confenge.service": service,
            "org.opencontainers.image.revision": sha,
            "org.opencontainers.image.version": sha,
          },
        },
        environment: { CC_RELEASE_SHA: sha },
      },
    ]),
  );
  return JSON.stringify({ services });
}

function fakeRuntime(): { bin: string; secretEnv: string; collectorOverlay: string } {
  const root = mkdtempSync(join(tmpdir(), "cc-release-attestation-"));
  tempDirs.push(root);
  const secretEnv = join(root, "secrets.env");
  const collectorOverlay = join(root, "collector-env.yml");
  writeFileSync(secretEnv, "", "utf8");
  writeFileSync(collectorOverlay, "services:\n  collector: {}\n", "utf8");

  const docker = join(root, "docker");
  writeFileSync(
    docker,
    `#!/bin/sh
command_name=""
for argument in "$@"; do
  case "$argument" in
    config|ps|build|up) command_name="$argument"; break ;;
  esac
done
if [ "$1" = "compose" ]; then
  case "$command_name" in
    config) printf '%s\n' "$FAKE_COMPOSE_JSON"; exit 0 ;;
    ps)
      for last_argument in "$@"; do :; done
      if [ "$last_argument" = "$FAKE_MISSING_SERVICE" ]; then exit 0; fi
      printf 'container-%s\n' "$last_argument"
      exit 0
      ;;
    *) exit 2 ;;
  esac
fi
if [ "$1" = "inspect" ]; then
  target="$2"
  service="$(printf '%s' "$target" | sed -e 's/^container-//' -e 's/^sha256:fixture-//')"
  service_sha="$FAKE_RELEASE_SHA"
  if [ "$service" = "$FAKE_DIVERGENT_SERVICE" ]; then service_sha="$FAKE_DIVERGENT_SHA"; fi
  env_sha="$service_sha"
  if [ "$service" = "$FAKE_ENV_DIVERGENT_SERVICE" ]; then env_sha="$FAKE_DIVERGENT_SHA"; fi
  case "$*" in
    *org.opencontainers.image.revision*) printf '%s\n' "$service_sha" ;;
    *br.com.confenge.service*) printf '%s\n' "$service" ;;
    *Config.Env*)
      printf 'CC_RELEASE_SHA=%s\n' "$env_sha"
      if [ "$service" = collector ] && [ "$FAKE_COLLECTOR_TOKEN_MISSING" != true ]; then
        printf 'WARMBLY_API_TOKEN=fixture-read-only\nWARMBLY_BASE_URL=http://backend:8080\n'
      fi
      ;;
    *State.Health*)
      if [ "$service" = "$FAKE_UNHEALTHY_SERVICE" ]; then printf 'unhealthy\n'; else printf 'healthy\n'; fi
      ;;
    *State.Running*) printf 'true\n' ;;
    *Config.Image*) printf 'confenge-control-center-%s:%s\n' "$service" "$service_sha" ;;
    *NetworkSettings.Networks*)
      if [ "$FAKE_COLLECTOR_NETWORK_MISSING" = true ]; then printf '{"confenge-cc-internal":{}}\n';
      else printf '{"warmbly-confenge_default":{}}\n'; fi
      ;;
    *'{{.Image}}'*) printf 'sha256:fixture-%s\n' "$service" ;;
    *) exit 0 ;;
  esac
  exit 0
fi
if [ "$1" = "exec" ]; then printf '%s' "$FAKE_HTTP_SHA"; exit 0; fi
exit 2
`,
    "utf8",
  );
  chmodSync(docker, 0o755);

  const git = join(root, "git");
  writeFileSync(
    git,
    `#!/bin/sh
case "$1" in
  cat-file) exit 0 ;;
  rev-parse)
    case "$*" in
      *--show-toplevel*) printf '%s\n' "$FAKE_REPO_ROOT" ;;
      *) if [ -n "$FAKE_GIT_HEAD" ]; then printf '%s\n' "$FAKE_GIT_HEAD"; else printf '%s\n' "$FAKE_RELEASE_SHA"; fi ;;
    esac
    ;;
  status)
    if [ "$FAKE_GIT_DIRTY" = true ]; then
      printf ' M control-center/deploy/overlays/production-edge/deploy-release.sh\n'
    fi
    ;;
  merge-base) if [ "$FAKE_GIT_ANCESTRY" = invalid ]; then exit 1; fi ;;
  *) exec /usr/bin/git "$@" ;;
esac
`,
    "utf8",
  );
  chmodSync(git, 0o755);
  return { bin: root, secretEnv, collectorOverlay };
}

function repositoryHead(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function runVerify(overrides: NodeJS.ProcessEnv = {}, sha = repositoryHead()) {
  const runtime = fakeRuntime();
  return spawnSync("bash", [SCRIPT, sha], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      PATH: `${runtime.bin}:${process.env.PATH ?? ""}`,
      CC_SECRET_ENV: runtime.secretEnv,
      CC_COLLECTOR_ENV_COMPOSE: runtime.collectorOverlay,
      CC_WEB_ACTOR_COMPOSE: join(runtime.bin, "absent-web-actor.yml"),
      FAKE_REPO_ROOT: REPOSITORY_ROOT,
      FAKE_RELEASE_SHA: repositoryHead(),
      FAKE_HTTP_SHA: repositoryHead(),
      FAKE_DIVERGENT_SHA: "0000000000000000000000000000000000000000",
      FAKE_COMPOSE_JSON: composeConfig(repositoryHead()),
      ...overrides,
    },
    encoding: "utf8",
  });
}

test("release attestation derives and reconciles every release service", () => {
  const result = runVerify();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /RELEASE VERIFICATION PASSED/);
  assert.equal((result.stdout.match(/^--- /gm) ?? []).length, 4);
  assert.match(result.stdout, /collector release and read-only observation topology converge/);
});

test("health green still fails when collector kept a previous release", () => {
  const result = runVerify({ FAKE_DIVERGENT_SERVICE: "collector" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /collector[\s\S]*image ref does not match rendered compose/);
  assert.match(result.stdout, /RELEASE VERIFICATION FAILED/);
});

test("restart with current image but stale MCP runtime SHA fails", () => {
  const result = runVerify({ FAKE_ENV_DIVERGENT_SERVICE: "mcp" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /mcp[\s\S]*runtime CC_RELEASE_SHA .* does not exactly match expected/);
});

test("partial deploy with a missing service fails", () => {
  const result = runVerify({ FAKE_MISSING_SERVICE: "collector" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FAIL collector: compose container not found/);
});

test("running but unhealthy service fails", () => {
  const result = runVerify({ FAKE_UNHEALTHY_SERVICE: "mcp" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /container is not running and healthy/);
});

test("collector release fails without read-only credential or Warmbly network", () => {
  const token = runVerify({ FAKE_COLLECTOR_TOKEN_MISSING: "true" });
  assert.notEqual(token.status, 0);
  assert.match(token.stdout, /collector lost its read-only Warmbly credential/);

  const network = runVerify({ FAKE_COLLECTOR_NETWORK_MISSING: "true" });
  assert.notEqual(network.status, 0);
  assert.match(network.stdout, /collector lost its Warmbly network/);
});

test("release attestation fails closed when the live HTTP SHA differs", () => {
  const result = runVerify({ FAKE_HTTP_SHA: "0000000000000000000000000000000000000000" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /runtime HTTP identity .* does not exactly match expected/);
});

test("release attestation rejects tags and abbreviated SHAs", () => {
  const result = runVerify({}, "64ece7d");
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /exactly one full lowercase 40-character commit identity/);
});

test("release attestation rejects a full SHA outside the required baseline", () => {
  const result = runVerify({ FAKE_GIT_ANCESTRY: "invalid" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /does not descend from required baseline/);
});

test("rollback to a SHA other than checked-out HEAD fails", () => {
  const result = runVerify({ FAKE_GIT_HEAD: "0000000000000000000000000000000000000000" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /checkout HEAD .* does not exactly match expected/);
});

test("release attestation rejects a dirty image source tree", () => {
  const result = runVerify({ FAKE_GIT_DIRTY: "true" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /checkout contains tracked or untracked changes/);
});
