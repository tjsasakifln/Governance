import { execFileSync } from "node:child_process";
import { COMMIT_SHA_PATTERN, type GitMetadataProvider } from "./types.js";

const ZERO_SHA = /^0+$/;

export function isUsableCommitSha(value: string | null | undefined): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim().toLowerCase();
  if (!COMMIT_SHA_PATTERN.test(trimmed)) {
    return false;
  }
  if (ZERO_SHA.test(trimmed)) {
    return false;
  }
  return true;
}

export function injectedGit(commitSha: string): GitMetadataProvider {
  if (!isUsableCommitSha(commitSha)) {
    throw new Error("injected commit SHA is missing or not a usable git object id");
  }
  const sha = commitSha.trim().toLowerCase();
  return {
    commitShaFor: () => sha,
    headSha: () => sha,
    pathExistsInHead: () => true,
  };
}

export function liveGit(repoRoot: string): GitMetadataProvider {
  return {
    commitShaFor(sourcePath: string): string | null {
      return gitText(repoRoot, ["log", "-1", "--format=%H", "--", sourcePath]);
    },
    headSha(): string | null {
      return gitText(repoRoot, ["rev-parse", "HEAD"]);
    },
    pathExistsInHead(sourcePath: string): boolean {
      try {
        execFileSync("git", ["cat-file", "-e", `HEAD:${sourcePath}`], {
          cwd: repoRoot,
          stdio: ["ignore", "pipe", "pipe"],
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

function gitText(repoRoot: string, args: string[]): string | null {
  try {
    const out = execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return isUsableCommitSha(out) ? out.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Resolve commit SHA for a source path. Never fabricates.
 * 1. Path-specific `git log`
 * 2. HEAD, only if the path exists in that commit
 * 3. null → caller fail-closes
 */
export function resolveCommitSha(
  git: GitMetadataProvider,
  sourcePath: string,
): string | null {
  const fromPath = git.commitShaFor(sourcePath);
  if (isUsableCommitSha(fromPath)) {
    return fromPath.toLowerCase();
  }
  const head = git.headSha();
  if (!isUsableCommitSha(head)) {
    return null;
  }
  if (git.pathExistsInHead && !git.pathExistsInHead(sourcePath)) {
    return null;
  }
  if (!git.pathExistsInHead) {
    return null;
  }
  return head.toLowerCase();
}
