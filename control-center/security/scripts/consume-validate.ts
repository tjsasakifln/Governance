#!/usr/bin/env node
/**
 * Non-test consumer of the shipped validator. Proves the public entry
 * accepts/rejects a security bundle without going through the test runner.
 */
import { validateBundle } from "../src/index.js";

const bundle = process.argv[2];
if (bundle === undefined) {
  process.stderr.write("usage: tsx scripts/consume-validate.ts <bundle-dir>\n");
  process.exit(2);
}

const result = validateBundle(bundle);
const verdict = result.ok ? "ACCEPT" : "REJECT";
process.stdout.write(`${verdict}\n${JSON.stringify(result, null, 2)}\n`);
process.exit(result.ok ? 0 : 1);
