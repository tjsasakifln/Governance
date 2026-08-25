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

function fakeDockerBin(): string {
  const root = mkdtempSync(join(tmpdir(), "cc-release-attestation-"));
  tempDirs.push(root);
  const script = join(root, "docker");
  writeFileSync(script, `#!/bin/sh
case "$1" in
  inspect)
    case "$*" in
      *org.opencontainers.image.revision*) printf '%s\\n' "$FAKE_RELEASE_SHA" ;;
      *Config.Env*) printf 'CC_RELEASE_SHA=%s\\n' "$FAKE_RELEASE_SHA" ;;
      *State.Running*) printf 'true\\n' ;;
      *Config.Image*) printf 'confenge-control-center:test\\n' ;;
      *"{{.Image}}"*) printf 'sha256:fixture-image-id\\n' ;;
      *) exit 0 ;;
    esac
    ;;
  exec) printf '%s' "$FAKE_HTTP_SHA" ;;
  *) exit 2 ;;
esac
`, "utf8");
  chmodSync(script, 0o755);
  return root;
}

function repositoryHead(): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("release attestation reconciles repository, image, container env and HTTP identity", () => {
  const sha = repositoryHead();
  const bin = fakeDockerBin();
  const result = spawnSync("bash", [SCRIPT, sha, "context", "web"], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      FAKE_RELEASE_SHA: sha,
      FAKE_HTTP_SHA: sha,
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /runtime HTTP:/);
  assert.match(result.stdout, /RELEASE VERIFICATION PASSED/);
  assert.equal((result.stdout.match(/reconciles with image label and runtime/g) ?? []).length, 2);
});

test("release attestation fails closed when the live HTTP SHA differs", () => {
  const sha = repositoryHead();
  const bin = fakeDockerBin();
  const result = spawnSync("bash", [SCRIPT, sha, "context", "web"], {
    cwd: REPOSITORY_ROOT,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      FAKE_RELEASE_SHA: sha,
      FAKE_HTTP_SHA: "0000000000000000000000000000000000000000",
    },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /runtime HTTP identity .* does not exactly match expected/);
  assert.match(result.stdout, /RELEASE VERIFICATION FAILED/);
});

test("release attestation rejects tags and abbreviated SHAs as mutable identities", () => {
  const result = spawnSync("bash", [SCRIPT, "64ece7d", "context", "web"], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /full lowercase 40-character commit identity/);
});
