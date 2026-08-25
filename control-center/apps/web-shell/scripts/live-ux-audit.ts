import { readFile } from "node:fs/promises";
import {
  buildLiveUxAuditPlan,
  validateLiveUxAudit,
} from "../src/live-ux-audit.ts";

function usage(): never {
  process.stderr.write(
    [
      "Usage:",
      "  npm run audit:ux --workspace=@confenge/control-center-web-shell -- plan",
      "  npm run audit:ux --workspace=@confenge/control-center-web-shell -- validate <evidence.json>",
      "  npm run audit:ux --workspace=@confenge/control-center-web-shell -- gate <evidence.json>",
      "",
      "validate checks provenance and evidence completeness.",
      "gate additionally requires every live human observation to pass.",
    ].join("\n"),
  );
  process.exit(64);
}

async function readEvidence(path: string): Promise<unknown> {
  const serialized = await readFile(path, "utf8");
  return JSON.parse(serialized) as unknown;
}

async function main(): Promise<void> {
  const [command, path, ...extra] = process.argv.slice(2);
  if (extra.length > 0) usage();

  if (command === "plan" && path === undefined) {
    const plan = buildLiveUxAuditPlan();
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    if (plan.consistencyErrors.length > 0) process.exitCode = 1;
    return;
  }

  if ((command === "validate" || command === "gate") && path !== undefined) {
    const result = validateLiveUxAudit(await readEvidence(path));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.valid || (command === "gate" && !result.auditPassed)) {
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
