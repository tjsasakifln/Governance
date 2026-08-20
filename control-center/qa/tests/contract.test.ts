import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  ATTACK_IDS,
  ATTACK_COUNT,
  EVALUATORS,
  evaluateAttack,
  evaluateFixturePayload,
  loadAttackFixture,
  loadControlFixture,
  loadExplicitChecks,
  loadMatrixJson,
  loadMergeChecklistJson,
  loadReadyDefinitionJson,
  readyForInternalProduction,
  runAdversarialCorpus,
  runControlCorpus,
  runExplicitChecksCorpus,
  runGate,
  formatReport,
  parseCorpus,
} from "../src/index.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readPackageFile(rel: string): string {
  return readFileSync(join(PACKAGE_ROOT, rel), "utf8");
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTs(abs));
    } else if (entry.name.endsWith(".ts")) {
      out.push(abs);
    }
  }
  return out;
}

describe("canonical attack list", () => {
  it("has exactly 14 verbatim attack ids and matching evaluators", () => {
    assert.equal(ATTACK_IDS.length, 14);
    assert.equal(ATTACK_COUNT, 14);
    assert.deepEqual(ATTACK_IDS, [
      "stale data mostrado como saudável",
      "double counting financeiro",
      "hypothesis promovida a fact",
      "agent sobrescrevendo founder decision",
      "scope leakage entre cliente/repos",
      "duplicated collector event",
      "provider mutation acidental",
      "secret/PII leakage",
      "timezone boundary",
      "partial outage",
      "stale RUNNING agent session",
      "conflicting directives/supersession",
      "auth bypass assumptions",
      "missing provenance",
    ]);
    for (const id of ATTACK_IDS) {
      assert.equal(typeof EVALUATORS[id], "function");
    }
  });
});

describe("shipped evaluators on synthetic fixtures", () => {
  for (const attackId of ATTACK_IDS) {
    it(`detects ${attackId} from the adversarial fixture`, () => {
      const fixture = loadAttackFixture(attackId);
      const viaRegistry = evaluateAttack(attackId, fixture.payload);
      const viaGate = evaluateFixturePayload(attackId, fixture.payload);
      assert.equal(fixture.attack_id, attackId);
      assert.equal(viaRegistry.attack_id, attackId);
      assert.equal(viaRegistry.state, "fail");
      assert.equal(viaGate.state, "fail");
      assert.equal(viaGate.attack_id, attackId);
      assert.notEqual(viaRegistry.reason, "");
    });

    it(`does not classify the control as ${attackId}`, () => {
      const fixture = loadControlFixture(attackId);
      const verdict = evaluateAttack(attackId, fixture.payload);
      assert.equal(verdict.attack_id, attackId);
      assert.equal(verdict.state, "pass");
    });
  }
});

describe("READY_FOR_INTERNAL_PRODUCTION reducer", () => {
  it("is true only when every named check is explicitly pass", () => {
    const allPass = loadExplicitChecks("all-pass");
    const ready = readyForInternalProduction(allPass.checks);
    assert.equal(allPass.checks.length, 14);
    assert.ok(allPass.checks.every((c) => c.state === "pass"));
    assert.equal(ready.READY_FOR_INTERNAL_PRODUCTION, true);
    assert.equal(ready.passed_checks.length, 14);
    assert.deepEqual(ready.missing_checks, []);
    assert.deepEqual(ready.failed_checks, []);
    assert.deepEqual(ready.unknown_checks, []);
  });

  it("is false when a check is UNKNOWN", () => {
    const file = loadExplicitChecks("unknown-check");
    const ready = readyForInternalProduction(file.checks);
    assert.equal(ready.READY_FOR_INTERNAL_PRODUCTION, false);
    assert.ok(ready.unknown_checks.includes("missing provenance"));
  });

  it("is false when a named check is missing/unrun", () => {
    const file = loadExplicitChecks("missing-check");
    const ready = readyForInternalProduction(file.checks);
    assert.equal(ready.READY_FOR_INTERNAL_PRODUCTION, false);
    assert.ok(ready.missing_checks.includes("missing provenance"));
  });

  it("is false for empty checks", () => {
    const ready = readyForInternalProduction([]);
    assert.equal(ready.READY_FOR_INTERNAL_PRODUCTION, false);
    assert.equal(ready.missing_checks.length, 14);
  });

  it("is false when a pass set is missing one id even if a duplicate is added", () => {
    const allPass = loadExplicitChecks("all-pass").checks;
    const withoutLast = allPass.filter((c) => c.attack_id !== "missing provenance");
    const duplicate = allPass[0];
    assert.ok(duplicate);
    const ready = readyForInternalProduction([...withoutLast, duplicate]);
    assert.equal(ready.READY_FOR_INTERNAL_PRODUCTION, false);
    assert.ok(ready.missing_checks.includes("missing provenance"));
  });

  it("grants ready from control-fixture evaluator results only if all 14 pass", () => {
    const checks = ATTACK_IDS.map((id) => {
      const verdict = evaluateAttack(id, loadControlFixture(id).payload);
      return { attack_id: verdict.attack_id, state: verdict.state, reason: verdict.reason };
    });
    const ready = readyForInternalProduction(checks);
    assert.equal(ready.READY_FOR_INTERNAL_PRODUCTION, true);
  });

  it("refuses ready from adversarial evaluator results", () => {
    const checks = ATTACK_IDS.map((id) => {
      const verdict = evaluateAttack(id, loadAttackFixture(id).payload);
      return { attack_id: verdict.attack_id, state: verdict.state, reason: verdict.reason };
    });
    const ready = readyForInternalProduction(checks);
    assert.equal(ready.READY_FOR_INTERNAL_PRODUCTION, false);
    assert.equal(ready.failed_checks.length, 14);
  });
});

describe("adversarial corpus (shipped runner used by the CLI)", () => {
  it("lists every named attack, fails each case, and does not grant READY", () => {
    const report = runAdversarialCorpus();
    const printed = formatReport(report);
    assert.equal(report.corpus, "adversarial");
    assert.equal(report.hostile, true);
    assert.equal(report.READY_FOR_INTERNAL_PRODUCTION, false);
    assert.equal(report.named_attacks.length, 14);
    assert.deepEqual(report.named_attacks, [...ATTACK_IDS]);
    assert.equal(report.attacks.length, 14);
    for (const id of ATTACK_IDS) {
      assert.ok(printed.includes(id), `CLI report must list ${id}`);
      const row = report.attacks.find((a) => a.attack_id === id);
      assert.ok(row);
      assert.equal(row.state, "fail");
      assert.equal(row.ready_contribution, "not-ready");
      assert.equal(row.case_kind, "adversarial");
    }
    assert.equal(report.forbidden_side_effects.cobranca, false);
    assert.equal(report.forbidden_side_effects.checkout, false);
    assert.equal(report.forbidden_side_effects.refund, false);
    assert.equal(report.forbidden_side_effects.cancelamento, false);
    assert.equal(report.forbidden_side_effects.asaas_write, false);
    assert.equal(report.forbidden_side_effects.commercial_send, false);
  });

  it("runGate(adversarial) is the same shipped entry the CLI uses", () => {
    assert.equal(parseCorpus([]), "adversarial");
    const report = runGate("adversarial");
    assert.equal(report.READY_FOR_INTERNAL_PRODUCTION, false);
    assert.equal(report.attacks.every((a) => a.state === "fail"), true);
  });
});

describe("control corpus", () => {
  it("does not flag controls as attacks and can satisfy READY", () => {
    const report = runControlCorpus();
    assert.equal(report.attacks.length, 14);
    for (const row of report.attacks) {
      assert.equal(row.state, "pass");
      assert.equal(row.ready_contribution, "ready-component");
    }
    assert.equal(report.READY_FOR_INTERNAL_PRODUCTION, true);
  });
});

describe("explicit check corpora", () => {
  it("all-pass grants READY only through the reducer", () => {
    const report = runExplicitChecksCorpus("all-pass");
    assert.equal(report.READY_FOR_INTERNAL_PRODUCTION, true);
  });

  it("unknown-check does not grant READY", () => {
    const report = runExplicitChecksCorpus("unknown-check");
    assert.equal(report.READY_FOR_INTERNAL_PRODUCTION, false);
  });

  it("missing-check does not grant READY", () => {
    const report = runExplicitChecksCorpus("missing-check");
    assert.equal(report.READY_FOR_INTERNAL_PRODUCTION, false);
  });
});

describe("docs and machine matrix name every attack", () => {
  it("threat matrix JSON lists the 14 ids in order", () => {
    const matrix = loadMatrixJson();
    assert.ok(matrix && typeof matrix === "object");
    const attacks = (matrix as { attacks?: unknown }).attacks;
    assert.ok(Array.isArray(attacks));
    const ids = attacks.map((row) => {
      assert.ok(row && typeof row === "object");
      return (row as { attack_id?: unknown }).attack_id;
    });
    assert.deepEqual(ids, [...ATTACK_IDS]);
  });

  it("READY definition JSON lists the 14 ids in order", () => {
    const def = loadReadyDefinitionJson();
    assert.ok(def && typeof def === "object");
    const required = (def as { required_checks?: unknown }).required_checks;
    assert.deepEqual(required, [...ATTACK_IDS]);
  });

  it("merge checklist JSON names every attack", () => {
    const checklist = loadMergeChecklistJson();
    assert.ok(checklist && typeof checklist === "object");
    const items = (checklist as { items?: unknown }).items;
    assert.ok(Array.isArray(items));
    const named = items
      .map((row) => {
        if (!row || typeof row !== "object") {
          return undefined;
        }
        return (row as { attack_id?: unknown }).attack_id;
      })
      .filter((id): id is string => typeof id === "string");
    for (const id of ATTACK_IDS) {
      assert.ok(named.includes(id), `checklist missing ${id}`);
    }
  });

  it("README and docs name every attack verbatim", () => {
    const blobs = [
      readPackageFile("README.md"),
      readPackageFile("docs/THREAT-QUALITY-MATRIX.md"),
      readPackageFile("docs/MERGE-CONVERGENCE-CHECKLIST.md"),
      readPackageFile("docs/READY-FOR-INTERNAL-PRODUCTION.md"),
    ].join("\n");
    for (const id of ATTACK_IDS) {
      assert.ok(blobs.includes(id), `docs missing ${id}`);
    }
  });
});

describe("leak evaluator does not echo secrets", () => {
  it("records paths/kinds only", () => {
    const fixture = loadAttackFixture("secret/PII leakage");
    const verdict = evaluateAttack("secret/PII leakage", fixture.payload);
    assert.equal(verdict.state, "fail");
    const blob = JSON.stringify(verdict);
    assert.equal(blob.includes("sk_test_"), false);
    assert.equal(blob.includes("ghp_"), false);
    assert.equal(blob.includes("000.000.000-00"), false);
    assert.equal(blob.includes("synthetic.founder@example.invalid"), false);
    const evidence = verdict.evidence;
    assert.ok(Array.isArray(evidence.leaked_paths));
    assert.ok(Array.isArray(evidence.kinds));
  });
});

describe("package isolation and no provider I/O", () => {
  it("src does not call fetch or known provider hosts", () => {
    const files = walkTs(join(PACKAGE_ROOT, "src"));
    assert.ok(files.length > 0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      assert.equal(text.includes("fetch("), false, file);
      assert.equal(text.includes("https://api.asaas.com"), false, file);
      assert.equal(text.includes("api.github.com"), false, file);
    }
  });

  it("does not import other control-center workstreams", () => {
    const files = walkTs(join(PACKAGE_ROOT, "src")).concat(
      walkTs(join(PACKAGE_ROOT, "tests")),
    );
    const importSibling =
      /(?:from|require\()\s*["'][^"']*(?:control-center\/(?:contracts|services)|@confenge\/control-center-(?:contracts|mcp))/;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      assert.equal(importSibling.test(text), false, file);
    }
  });
});
