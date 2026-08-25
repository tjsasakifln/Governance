export const REQUIRED_RUNTIME_BASELINE_SHA = "64ece7d38abacd3adeaa02735b4f22af66caab0f";

const FULL_GIT_SHA = /^[0-9a-f]{40}$/;

export interface RuntimeIdentity {
  schema_version: "control-center.runtime-identity.v1";
  service: string;
  release_sha: string | null;
  required_baseline_sha: typeof REQUIRED_RUNTIME_BASELINE_SHA;
  release_status: "PINNED" | "UNVERIFIED";
  production_required: boolean;
}

export function runtimeIdentityFromEnv(
  env: NodeJS.ProcessEnv,
  service: string,
): RuntimeIdentity {
  const candidate = (env.CC_RELEASE_SHA ?? "").trim();
  const releaseSha = FULL_GIT_SHA.test(candidate) ? candidate : null;
  return {
    schema_version: "control-center.runtime-identity.v1",
    service,
    release_sha: releaseSha,
    required_baseline_sha: REQUIRED_RUNTIME_BASELINE_SHA,
    release_status: releaseSha === null ? "UNVERIFIED" : "PINNED",
    production_required: env.CONTROL_CENTER_ENV === "production",
  };
}

export function runtimeIdentityAllowsReady(identity: RuntimeIdentity): boolean {
  return !identity.production_required || identity.release_status === "PINNED";
}
