#!/usr/bin/env node
/**
 * Non-test consumer of the shipped validator. Used to prove the public
 * entry accepts/rejects fixtures without going through the test runner.
 */
import { readFileSync } from "node:fs";
import { validateUnknown } from "../src/index.js";

const file = process.argv[2];
if (file === undefined) {
  process.stderr.write("usage: tsx scripts/consume-validate.ts <file.json>\n");
  process.exit(2);
}

const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
const result = validateUnknown(parsed);
const verdict = result.ok ? "ACCEPT" : "REJECT";
process.stdout.write(`${verdict}\n${JSON.stringify(result, null, 2)}\n`);
process.exit(result.ok ? 0 : 1);
