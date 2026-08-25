import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildLiveUxAuditPlan,
  liveUxAuditIssueNumbers,
  liveUxAuditMediaDigests,
  validateLiveUxAudit,
} from "../src/live-ux-audit.ts";

function usage(): never {
  process.stderr.write(
    [
      "Usage:",
      "  npm run audit:ux --workspace=@confenge/control-center-web-shell -- plan",
      "  npm run audit:ux --workspace=@confenge/control-center-web-shell -- validate <evidence.json>",
      "  npm run audit:ux --workspace=@confenge/control-center-web-shell -- gate <evidence.json> <media-directory>",
      "",
      "validate checks provenance, completeness, and that friction issues exist.",
      "gate additionally requires every observation to pass and every media digest to resolve to a real file.",
    ].join("\n"),
  );
  process.exit(64);
}

async function readEvidence(path: string): Promise<unknown> {
  const serialized = await readFile(path, "utf8");
  return JSON.parse(serialized) as unknown;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function filesBelow(directory: string): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    if (entry.isFile()) files.push(path);
  }
  return files;
}

async function verifyMedia(value: unknown, directory: string): Promise<readonly string[]> {
  const expected = new Set(liveUxAuditMediaDigests(value));
  const observed = new Set<string>();
  for (const path of await filesBelow(directory)) observed.add(await sha256File(path));
  return [...expected]
    .filter((digest) => !observed.has(digest))
    .map((digest) => `Media artifact ${digest} is absent from the authorized media directory.`);
}

async function verifyIssues(value: unknown): Promise<readonly string[]> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "confenge-live-ux-audit",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  return (await Promise.all(liveUxAuditIssueNumbers(value).map(async (issueNumber) => {
    try {
      const response = await fetch(
        `https://api.github.com/repos/tjsasakifln/Governance/issues/${issueNumber}`,
        { headers, signal: AbortSignal.timeout(5_000) },
      );
      if (!response.ok) return `Governance issue #${issueNumber} could not be verified (HTTP ${response.status}).`;
      const issue = await response.json() as Record<string, unknown>;
      if ("pull_request" in issue) return `Governance reference #${issueNumber} is a pull request, not a finding issue.`;
      if (issue.number !== issueNumber) return `Governance issue #${issueNumber} returned a divergent identity.`;
      return null;
    } catch {
      return `Governance issue #${issueNumber} could not be verified.`;
    }
  }))).filter((error): error is string => error !== null);
}

async function main(): Promise<void> {
  const [command, path, mediaDirectory, ...extra] = process.argv.slice(2);
  if (extra.length > 0) usage();

  if (command === "plan" && path === undefined && mediaDirectory === undefined) {
    const plan = buildLiveUxAuditPlan();
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    if (plan.consistencyErrors.length > 0) process.exitCode = 1;
    return;
  }

  if (
    path !== undefined &&
    ((command === "validate" && mediaDirectory === undefined) ||
      (command === "gate" && mediaDirectory !== undefined))
  ) {
    const evidence = await readEvidence(path);
    const result = validateLiveUxAudit(evidence);
    const issueErrors = result.valid ? await verifyIssues(evidence) : [];
    const mediaErrors = command === "gate" && result.valid
      ? await verifyMedia(evidence, mediaDirectory)
      : [];
    const errors = [...result.errors, ...issueErrors, ...mediaErrors];
    const completed = {
      ...result,
      valid: result.valid && issueErrors.length === 0,
      auditPassed:
        command === "gate" &&
        result.uxCriteriaPassed &&
        issueErrors.length === 0 &&
        mediaErrors.length === 0,
      errors,
    };
    process.stdout.write(`${JSON.stringify(completed, null, 2)}\n`);
    if (!completed.valid || (command === "gate" && !completed.auditPassed)) {
      process.exitCode = 1;
    }
    return;
  }

  usage();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`live UX audit failed: ${message}\n`);
  process.exitCode = 1;
});
