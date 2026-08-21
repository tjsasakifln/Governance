import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  FRESHNESS_STATUSES,
  validateFile,
  validateUnknown,
} from "@confenge/control-center-contracts";

const contractsRoot = join(dirname(fileURLToPath(import.meta.url)), "../../contracts");

test("contracts validator accepts valid fixtures and rejects invalid freshness/scope/status", () => {
  const valid = validateFile("Directive", join(contractsRoot, "fixtures/valid/directive.json"));
  assert.equal(valid.ok, true);
  const invalidFresh = JSON.parse(
    readFileSync(join(contractsRoot, "fixtures/invalid/directive.json"), "utf8"),
  ) as Record<string, unknown>;
  const rejected = validateUnknown(invalidFresh);
  assert.equal(rejected.ok, false);
  assert.deepEqual([...FRESHNESS_STATUSES], ["FRESH", "STALE", "UNKNOWN", "ERROR"]);
});
