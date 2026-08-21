#!/usr/bin/env node
import { validateFile, listResourceTypes } from "./validate.js";
import { classifyCompatibility } from "./compatibility.js";
import { contractFingerprint } from "./fingerprint.js";
import { isResourceTypeName } from "./ids.js";
import type { ResourceTypeName } from "./taxonomy.js";
import { readFileSync } from "node:fs";

function printUsage(): void {
  const types = listResourceTypes().join(", ");
  process.stderr.write(
    `Usage:
  tsx src/cli.ts --list-types
  tsx src/cli.ts --fingerprint
  tsx src/cli.ts --classify <file.json>
  tsx src/cli.ts [--type <ResourceType>] <file.json>

Resource types: ${types}

Output is JSON: {"ok":true|false,"type":"...","errors":[...]}
Exit 0 only when ok is true.
`,
  );
}

function parseArgs(argv: string[]): {
  list: boolean;
  fingerprint: boolean;
  classify: boolean;
  type?: ResourceTypeName;
  file?: string;
} {
  let list = false;
  let fingerprint = false;
  let classify = false;
  let type: ResourceTypeName | undefined;
  let file: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--list-types") {
      list = true;
    } else if (arg === "--fingerprint") {
      fingerprint = true;
    } else if (arg === "--classify") {
      classify = true;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        file = next;
        i += 1;
      }
    } else if (arg === "--type") {
      const next = argv[i + 1];
      if (next === undefined || !isResourceTypeName(next)) {
        throw new Error(`--type requires one of: ${listResourceTypes().join(", ")}`);
      }
      type = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg !== undefined && !arg.startsWith("-")) {
      file = arg;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { list, fingerprint, classify, type, file };
}

function main(): void {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    printUsage();
    process.exit(2);
    return;
  }

  if (parsed.list) {
    const payload = { ok: true, types: listResourceTypes() };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(0);
    return;
  }

  if (parsed.fingerprint) {
    const payload = { ok: true, fingerprint: contractFingerprint() };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(0);
    return;
  }

  if (parsed.classify) {
    if (parsed.file === undefined) {
      printUsage();
      process.exit(2);
      return;
    }
    try {
      const data: unknown = JSON.parse(readFileSync(parsed.file, "utf8"));
      const result = classifyCompatibility(data);
      const ok = result.verdict === "canonical";
      process.stdout.write(`${JSON.stringify({ ok, ...result }, null, 2)}\n`);
      process.exit(ok ? 0 : 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `${JSON.stringify({ ok: false, verdict: "reject", errors: [{ path: "", message }] }, null, 2)}\n`,
      );
      process.exit(1);
    }
    return;
  }

  if (parsed.file === undefined) {
    printUsage();
    process.exit(2);
    return;
  }

  try {
    const result = validateFile(parsed.type, parsed.file);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      `${JSON.stringify({ ok: false, type: parsed.type ?? "unknown", errors: [{ path: "", message }] }, null, 2)}\n`,
    );
    process.exit(1);
  }
}

main();
