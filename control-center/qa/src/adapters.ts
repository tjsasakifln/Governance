import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ATTACK_SLUGS, assertAttackId, type AttackId } from "./attacks.js";
import { fixturesDir, matrixDir } from "./paths.js";
import type { CheckInput, ExplicitChecksFile, QaFixture, VerdictState } from "./types.js";
import { isAttackId } from "./attacks.js";

/**
 * Adapter contracts for later convergence.
 *
 * This package ships a fixture-backed adapter only. Sibling Control Center
 * workstreams (persistence, context-service, MCP, collectors) are NOT imported.
 * A future campaign implements these ports against PostgreSQL / MCP without
 * rewriting evaluators or contract tests.
 *
 * ObservationPort.loadFreshness(asOf) → records with provenance + presentation
 * FinancePort.loadLedger() → integer cents lines keyed by source_payment_id
 * DirectivePort.loadDirectives() → kinds, actors, supersession, audit
 * ScopePort.loadAgentContext() → granted_scopes vs resource scopes
 * CollectorPort.loadEvents() → idempotency_key + applied/status
 * ToolPort.loadAttemptedOperations() → MCP/tool names (read-only by default)
 * LeakPort.loadSurfaces() → logs, URLs, payloads to scan (never echo secrets)
 * ClockPort.loadInstants() → UTC Z instants + presented calendar dates
 * HealthPort.loadHealth() → overall vs component checks / required sources
 * SessionPort.loadSessions() → open/live sessions + TTL
 * AuthPort.loadAuthAttempt() → fail-closed identity (no hardcoded passwords)
 */

export interface ObservationPort {
  loadFreshness(asOf: string): unknown;
}

export interface FinancePort {
  loadLedger(): unknown;
}

export interface DirectivePort {
  loadDirectives(): unknown;
}

export interface ScopePort {
  loadAgentContext(): unknown;
}

export interface CollectorPort {
  loadEvents(): unknown;
}

export interface ToolPort {
  loadAttemptedOperations(): unknown;
}

export interface LeakPort {
  loadSurfaces(): unknown;
}

export interface ClockPort {
  loadInstants(): unknown;
}

export interface HealthPort {
  loadHealth(): unknown;
}

export interface SessionPort {
  loadSessions(): unknown;
}

export interface AuthPort {
  loadAuthAttempt(): unknown;
}

export interface ProvenancePort {
  loadAggregates(): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isQaFixture(value: unknown): value is QaFixture {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schema_version === "control-center.qa-fixture.v1" &&
    isAttackId(value.attack_id) &&
    (value.case_kind === "adversarial" || value.case_kind === "control") &&
    typeof value.description === "string" &&
    (value.expected_state === "fail" || value.expected_state === "pass") &&
    typeof value.reject_outcome === "string" &&
    "payload" in value
  );
}

export function isExplicitChecksFile(value: unknown): value is ExplicitChecksFile {
  if (!isRecord(value)) {
    return false;
  }
  if (value.schema_version !== "control-center.qa-checks.v1") {
    return false;
  }
  if (typeof value.description !== "string" || !Array.isArray(value.checks)) {
    return false;
  }
  return value.checks.every(isCheckInput);
}

export function isCheckInput(value: unknown): value is CheckInput {
  if (!isRecord(value)) {
    return false;
  }
  if (!isAttackId(value.attack_id)) {
    return false;
  }
  const state = value.state;
  if (state !== "pass" && state !== "fail" && state !== "UNKNOWN") {
    return false;
  }
  if (value.reason !== undefined && typeof value.reason !== "string") {
    return false;
  }
  return true;
}

export function parseJsonFile(absPath: string): unknown {
  const raw = readFileSync(absPath, "utf8");
  return JSON.parse(raw) as unknown;
}

export function loadQaFixture(absPath: string): QaFixture {
  const parsed = parseJsonFile(absPath);
  if (!isQaFixture(parsed)) {
    throw new Error(`invalid QA fixture: ${absPath}`);
  }
  return parsed;
}

export function attackFixturePath(attackId: AttackId): string {
  return join(fixturesDir(), "attacks", `${ATTACK_SLUGS[attackId]}.json`);
}

export function controlFixturePath(attackId: AttackId): string {
  return join(fixturesDir(), "controls", `${ATTACK_SLUGS[attackId]}.json`);
}

export function loadAttackFixture(attackId: AttackId): QaFixture {
  const fixture = loadQaFixture(attackFixturePath(attackId));
  if (fixture.attack_id !== attackId) {
    throw new Error(`attack fixture id mismatch: ${attackId}`);
  }
  if (fixture.case_kind !== "adversarial" || fixture.expected_state !== "fail") {
    throw new Error(`attack fixture must be adversarial/fail: ${attackId}`);
  }
  return fixture;
}

export function loadControlFixture(attackId: AttackId): QaFixture {
  const fixture = loadQaFixture(controlFixturePath(attackId));
  if (fixture.attack_id !== attackId) {
    throw new Error(`control fixture id mismatch: ${attackId}`);
  }
  if (fixture.case_kind !== "control" || fixture.expected_state !== "pass") {
    throw new Error(`control fixture must be control/pass: ${attackId}`);
  }
  return fixture;
}

export function checksFilePath(name: "all-pass" | "unknown-check" | "missing-check"): string {
  return join(fixturesDir(), "gate", `${name}.json`);
}

export function loadExplicitChecks(
  name: "all-pass" | "unknown-check" | "missing-check",
): ExplicitChecksFile {
  const parsed = parseJsonFile(checksFilePath(name));
  if (!isExplicitChecksFile(parsed)) {
    throw new Error(`invalid checks file: ${name}`);
  }
  return parsed;
}

export function loadMatrixJson(): unknown {
  return parseJsonFile(join(matrixDir(), "threat-quality.v1.json"));
}

export function loadReadyDefinitionJson(): unknown {
  return parseJsonFile(join(matrixDir(), "ready-for-internal-production.v1.json"));
}

export function loadMergeChecklistJson(): unknown {
  return parseJsonFile(join(matrixDir(), "merge-convergence.v1.json"));
}

/**
 * FixturePort — the only adapter implementation in this campaign.
 * Later services replace `payload` with live rows of the same shapes.
 */
export class FixturePort
  implements
    ObservationPort,
    FinancePort,
    DirectivePort,
    ScopePort,
    CollectorPort,
    ToolPort,
    LeakPort,
    ClockPort,
    HealthPort,
    SessionPort,
    AuthPort,
    ProvenancePort
{
  constructor(private readonly payload: unknown) {}

  loadFreshness(_asOf: string): unknown {
    return this.payload;
  }
  loadLedger(): unknown {
    return this.payload;
  }
  loadDirectives(): unknown {
    return this.payload;
  }
  loadAgentContext(): unknown {
    return this.payload;
  }
  loadEvents(): unknown {
    return this.payload;
  }
  loadAttemptedOperations(): unknown {
    return this.payload;
  }
  loadSurfaces(): unknown {
    return this.payload;
  }
  loadInstants(): unknown {
    return this.payload;
  }
  loadHealth(): unknown {
    return this.payload;
  }
  loadSessions(): unknown {
    return this.payload;
  }
  loadAuthAttempt(): unknown {
    return this.payload;
  }
  loadAggregates(): unknown {
    return this.payload;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function parseVerdictState(value: unknown): VerdictState | null {
  if (value === "pass" || value === "fail" || value === "UNKNOWN") {
    return value;
  }
  return null;
}

export { assertAttackId };
