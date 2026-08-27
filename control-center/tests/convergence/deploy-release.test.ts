import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const OVERLAY = join(REPOSITORY_ROOT, "control-center", "deploy", "overlays", "production-edge");
const DEPLOY_SCRIPT = join(OVERLAY, "deploy-release.sh");
const SERVICE_PARSER = join(OVERLAY, "release-services.py");
const DEPLOY_SOURCE = readFileSync(DEPLOY_SCRIPT, "utf8");
const RELEASE_COMPOSE_SOURCE = readFileSync(join(OVERLAY, "release-compose.sh"), "utf8");
const PRODUCTION_RUNBOOK = readFileSync(
  join(REPOSITORY_ROOT, "control-center", "deploy", "PRODUCTION-RUNBOOK.md"),
  "utf8",
);
const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function repositoryHead(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function composeConfig(sha: string, includeFuture = true): string {
  const names = ["collector", "context", "mcp", "web"];
  if (includeFuture) names.push("future");
  const services = Object.fromEntries(
    names.map((service) => [
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

type DeployRuntime = {
  bin: string;
  collectorOverlay: string;
  evidenceDir: string;
  lockFile: string;
  secretEnv: string;
  trace: string;
};

function fakeDeployRuntime(): DeployRuntime {
  const root = mkdtempSync(join(tmpdir(), "cc-deploy-release-"));
  tempDirs.push(root);
  const secretEnv = join(root, "secrets.env");
  const collectorOverlay = join(root, "collector-env.yml");
  const evidenceDir = join(root, "evidence");
  const lockFile = join(root, "release.lock");
  const trace = join(root, "docker.trace");
  writeFileSync(secretEnv, "", "utf8");
  writeFileSync(collectorOverlay, "services:\n  collector: {}\n", "utf8");

  const git = join(root, "git");
  writeFileSync(
    git,
    `#!/bin/sh
case "$1" in
  status) if [ "$FAKE_GIT_DIRTY" = true ]; then printf ' M dirty-before-build\n'; fi ;;
  fetch|checkout|cat-file) exit 0 ;;
  rev-parse)
    case "$*" in
      *--show-toplevel*) printf '%s\n' "$FAKE_REPO_ROOT" ;;
      *) printf '%s\n' "$FAKE_RELEASE_SHA" ;;
    esac
    ;;
  merge-base) exit 0 ;;
  *) exit 2 ;;
esac
`,
    "utf8",
  );
  chmodSync(git, 0o755);

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
if [ "$1" = compose ]; then
  case "$command_name" in
    config)
      case "$*" in
        *--no-interpolate*) printf '%s\n' "$FAKE_TEMPLATE_COMPOSE_JSON" ;;
        *) printf '%s\n' "$FAKE_RENDERED_COMPOSE_JSON" ;;
      esac
      exit 0
      ;;
    ps)
      for last_argument in "$@"; do :; done
      printf 'container-%s\n' "$last_argument"
      exit 0
      ;;
    build)
      printf 'build|%s\n' "$*" >> "$FAKE_TRACE"
      exit 0
      ;;
    up)
      printf 'up|%s\n' "$*" >> "$FAKE_TRACE"
      if [ "$FAKE_UP_FAIL" = true ]; then exit 17; fi
      exit 0
      ;;
  esac
fi
if [ "$1" = inspect ]; then
  target="$2"
  service="$(printf '%s' "$target" | sed -e 's/^container-//' -e 's/^sha256:fixture-//')"
  case "$*" in
    *org.opencontainers.image.revision*) printf '%s\n' "$FAKE_RELEASE_SHA" ;;
    *br.com.confenge.service*) printf '%s\n' "$service" ;;
    *Config.Env*)
      printf 'CC_RELEASE_SHA=%s\n' "$FAKE_RELEASE_SHA"
      if [ "$service" = collector ]; then printf 'WARMBLY_API_TOKEN=fixture-read-only\n'; fi
      ;;
    *State.Health*) printf 'healthy\n' ;;
    *State.Running*) printf 'true\n' ;;
    *Config.Image*) printf 'confenge-control-center-%s:%s\n' "$service" "$FAKE_RELEASE_SHA" ;;
    *NetworkSettings.Networks*) printf '{"warmbly-confenge_default":{}}\n' ;;
    *'{{.Image}}'*) printf 'sha256:fixture-%s\n' "$service" ;;
    *) exit 0 ;;
  esac
  exit 0
fi
if [ "$1" = exec ]; then printf '%s' "$FAKE_RELEASE_SHA"; exit 0; fi
exit 2
`,
    "utf8",
  );
  chmodSync(docker, 0o755);

  const curl = join(root, "curl");
  writeFileSync(
    curl,
    `#!/bin/sh
case "$*" in
  *127.0.0.1*) printf '%s' "$FAKE_LOOPBACK_STATUS" ;;
  *auth.ops.confenge.com.br*) printf '200' ;;
  *ops.confenge.com.br*) printf '302' ;;
  *) exit 2 ;;
esac
`,
    "utf8",
  );
  chmodSync(curl, 0o755);

  return { bin: root, collectorOverlay, evidenceDir, lockFile, secretEnv, trace };
}

function runDeploy(overrides: NodeJS.ProcessEnv = {}, sha = repositoryHead()) {
  const runtime = fakeDeployRuntime();
  const releaseSha = repositoryHead();
  const template = composeConfig("${CC_RELEASE_SHA:-local}");
  const rendered = composeConfig(releaseSha);
  const result = spawnSync("bash", [DEPLOY_SCRIPT, sha], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      PATH: `${runtime.bin}:${process.env.PATH ?? ""}`,
      CC_REPO_ROOT: REPOSITORY_ROOT,
      CC_SECRET_ENV: runtime.secretEnv,
      CC_COLLECTOR_ENV_COMPOSE: runtime.collectorOverlay,
      CC_WEB_ACTOR_COMPOSE: join(runtime.bin, "absent-web-actor.yml"),
      CC_RELEASE_EVIDENCE_DIR: runtime.evidenceDir,
      CC_RELEASE_LOCK_FILE: runtime.lockFile,
      FAKE_REPO_ROOT: REPOSITORY_ROOT,
      FAKE_RELEASE_SHA: releaseSha,
      FAKE_TEMPLATE_COMPOSE_JSON: template,
      FAKE_RENDERED_COMPOSE_JSON: rendered,
      FAKE_TRACE: runtime.trace,
      FAKE_LOOPBACK_STATUS: "200",
      ...overrides,
    },
    encoding: "utf8",
  });
  return { result, runtime };
}

test("release service set is derived from compose, including a future service", () => {
  const sha = repositoryHead();
  const result = spawnSync("python3", [SERVICE_PARSER, "--expected", sha], {
    input: composeConfig(sha),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), ["collector", "context", "future", "mcp", "web"]);
  assert.doesNotMatch(DEPLOY_SOURCE, /RELEASE_SERVICES=\(/);
});

test("release parser fails when a stamped service lacks runtime SHA", () => {
  const sha = repositoryHead();
  const document = JSON.parse(composeConfig(sha));
  delete document.services.future.environment.CC_RELEASE_SHA;
  const result = spawnSync("python3", [SERVICE_PARSER, "--expected", sha], {
    input: JSON.stringify(document),
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /future does not receive the same CC_RELEASE_SHA/);
});

test("canonical compose preserves both collector overlays", () => {
  assert.match(RELEASE_COMPOSE_SOURCE, /docker-compose\.warmbly-collector\.override\.yml/);
  assert.match(
    RELEASE_COMPOSE_SOURCE,
    /\/etc\/confenge\/control-center\/docker-compose\.collector-env\.yml/,
  );
  assert.match(RELEASE_COMPOSE_SOURCE, /required collector environment overlay is not readable/);
});

test("canonical runbook delegates to deploy-release and contains no partial app rollout", () => {
  assert.match(PRODUCTION_RUNBOOK, /deploy-release\.sh/);
  assert.doesNotMatch(PRODUCTION_RUNBOOK, /build context web/);
  assert.doesNotMatch(PRODUCTION_RUNBOOK, /verify-release\.sh[^\n]*context web/);
});

test("deploy builds, waits and verifies the complete compose-derived set", () => {
  const { result, runtime } = runDeploy();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /compose-derived release services: collector context future mcp web/);
  assert.match(result.stdout, /GO:CONTROL_CENTER_RELEASE_CONVERGED/);
  const trace = readFileSync(runtime.trace, "utf8");
  assert.match(trace, /build\|.* collector context future mcp web/);
  assert.match(trace, /up\|.*--wait.* collector context future mcp web caddy/);
  assert.ok(readdirSync(runtime.evidenceDir).some((name) => name.startsWith("rollback-point-")));
  assert.ok(readdirSync(runtime.evidenceDir).some((name) => name.startsWith("release-receipt-")));
});

test("dirty checkout fails before any build", () => {
  const { result, runtime } = runDeploy({ FAKE_GIT_DIRTY: "true" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checkout is not clean; no image was built/);
  assert.equal(existsSync(runtime.trace), false);
});

test("historical full SHA is rejected as rollback, before Docker", () => {
  const { result, runtime } = runDeploy({}, "0000000000000000000000000000000000000000");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requested SHA is not contemporary origin\/main/);
  assert.equal(existsSync(runtime.trace), false);
});

test("partial compose failure writes a sanitized failure-state receipt", () => {
  const { result, runtime } = runDeploy({ FAKE_UP_FAIL: "true" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /partial-state receipt written/);
  assert.ok(readdirSync(runtime.evidenceDir).some((name) => name.startsWith("release-failure-")));
});

test("HTTP 500 after healthy containers still fails and records state", () => {
  const { result, runtime } = runDeploy({ FAKE_LOOPBACK_STATUS: "500" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /loopback_health expected HTTP 200, got 500/);
  assert.ok(readdirSync(runtime.evidenceDir).some((name) => name.startsWith("release-failure-")));
});
