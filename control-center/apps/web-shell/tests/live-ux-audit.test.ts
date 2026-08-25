import assert from "node:assert/strict";
import { test } from "node:test";
import {
  JOURNEY_IDS,
  LIVE_AUDIT_JOURNEYS,
  LIVE_AUDIT_ROUTES,
  LIVE_UX_AUDIT_ORIGIN,
  LIVE_UX_AUDIT_SCHEMA,
  VIEWPORTS,
  auditPlanConsistencyErrors,
  buildLiveUxAuditPlan,
  validateLiveUxAudit,
} from "../src/live-ux-audit";

const runtimeSha = "a".repeat(40);
const mediaSha = "b".repeat(64);

interface MutableObservation {
  journeyId: string;
  viewport: { id: string; width: number; height: number };
  routeKeys: string[];
  runtimeSha: string;
  sanitizedData: boolean;
  steps: string[];
  orientationMs: number;
  firstActionMs: number | null;
  outcome: string;
  videoSha256: string;
  screenshotSha256s: string[];
  frictions: Array<Record<string, unknown>>;
}

interface MutableEvidence {
  schemaVersion: string;
  executionMode: string;
  environment: { origin: string; runtimeSha: string; capturedAt: string };
  operator: { pseudonym: string; role: string; human: boolean; independent: boolean };
  safety: {
    syntheticDataOnly: boolean;
    realEmailSent: boolean;
    goIssued: boolean;
    outboundResumed: boolean;
    irreversibleAction: boolean;
  };
  observations: MutableObservation[];
}

function validEvidence(): MutableEvidence {
  return {
    schemaVersion: LIVE_UX_AUDIT_SCHEMA,
    executionMode: "HUMAN_AUTHENTICATED_LIVE",
    environment: {
      origin: LIVE_UX_AUDIT_ORIGIN,
      runtimeSha,
      capturedAt: "2026-08-25T14:30:00-03:00",
    },
    operator: {
      pseudonym: "external-operator-01",
      role: "skeptical operations reviewer",
      human: true,
      independent: true,
    },
    safety: {
      syntheticDataOnly: true,
      realEmailSent: false,
      goIssued: false,
      outboundResumed: false,
      irreversibleAction: false,
    },
    observations: LIVE_AUDIT_JOURNEYS.flatMap((journey) =>
      VIEWPORTS.map((viewport): MutableObservation => ({
        journeyId: journey.id,
        viewport:
          viewport.id === "primary-mobile"
            ? { id: viewport.id, width: viewport.width, height: viewport.height }
            : { id: viewport.id, width: viewport.minWidth, height: viewport.minHeight },
        routeKeys: [...journey.requiredRouteKeys],
        runtimeSha,
        sanitizedData: true,
        steps: ["Abrir a rota", "Identificar o estado", "Escolher a ação segura"],
        orientationMs: 2_500,
        firstActionMs: 4_000,
        outcome: "PASS",
        videoSha256: mediaSha,
        screenshotSha256s: [mediaSha],
        frictions: [],
      })),
    ),
  };
}

test("live plan contains exactly the ten required journeys and every registered route", () => {
  assert.equal(JOURNEY_IDS.length, 10);
  assert.equal(LIVE_AUDIT_JOURNEYS.length, 10);
  assert.equal(LIVE_AUDIT_ROUTES.length, 19);
  assert.deepEqual(auditPlanConsistencyErrors(), []);

  const assigned = new Set(LIVE_AUDIT_JOURNEYS.flatMap((journey) => journey.requiredRouteKeys));
  assert.deepEqual(
    [...assigned].sort(),
    LIVE_AUDIT_ROUTES.map((route) => route.key).sort(),
  );
});

test("generated plan is explicitly not executed evidence", () => {
  const plan = buildLiveUxAuditPlan();
  assert.equal(plan.status, "NOT_EXECUTED");
  assert.match(plan.warning, /not evidence/i);
  assert.equal(validateLiveUxAudit(plan).valid, false);
});

test("complete human live evidence passes provenance and UX gates", () => {
  const result = validateLiveUxAudit(validEvidence());
  assert.deepEqual(result, {
    valid: true,
    auditPassed: true,
    errors: [],
    gateFailures: [],
  });
});

test("every journey must be observed on mobile and desktop", () => {
  const evidence = validEvidence();
  evidence.observations.pop();

  const result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("Missing required observation")));
});

test("primary mobile is pinned to 390x844 and desktop has a useful minimum", () => {
  const evidence = validEvidence();
  const mobile = evidence.observations[0];
  const desktop = evidence.observations[1];
  assert.ok(mobile);
  assert.ok(desktop);
  mobile.viewport.width = 391;
  desktop.viewport.width = 1_024;

  const result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("exact 390x844")));
  assert.ok(result.errors.some((error) => error.includes("at least 1280")));
});

test("an observation cannot silently skip a registry-derived route", () => {
  const evidence = validEvidence();
  const transversal = evidence.observations.find(
    (observation) =>
      observation.journeyId === "transversal-without-internal-ids" &&
      observation.viewport.id === "primary-mobile",
  );
  assert.ok(transversal);
  transversal.routeKeys.pop();

  const result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("every route assigned")));
});

test("immutable runtime identity must be full and identical in every observation", () => {
  const evidence = validEvidence();
  const observation = evidence.observations[0];
  assert.ok(observation);
  observation.runtimeSha = "c".repeat(40);

  let result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("must match environment.runtimeSha")));

  evidence.environment.runtimeSha = "short";
  result = validateLiveUxAudit(evidence);
  assert.ok(result.errors.some((error) => error.includes("full lowercase 40-character")));
});

test("automation or a non-independent reviewer cannot impersonate the human gate", () => {
  const evidence = validEvidence();
  evidence.executionMode = "AUTOMATED";
  evidence.operator.human = false;
  evidence.operator.independent = false;

  const result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("automation is not a substitute")));
  assert.ok(result.errors.some((error) => error.includes("human=true")));
});

test("unsafe execution invalidates the evidence instead of normalizing it", () => {
  const evidence = validEvidence();
  evidence.safety.syntheticDataOnly = false;
  evidence.safety.realEmailSent = true;
  evidence.safety.goIssued = true;
  evidence.safety.outboundResumed = true;
  evidence.safety.irreversibleAction = true;

  const result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("syntheticDataOnly")));
  assert.ok(result.errors.some((error) => error.includes("realEmailSent")));
  assert.ok(result.errors.some((error) => error.includes("goIssued")));
  assert.ok(result.errors.some((error) => error.includes("outboundResumed")));
  assert.ok(result.errors.some((error) => error.includes("irreversibleAction")));
});

test("media is attested by digest without putting raw customer data in the manifest", () => {
  const evidence = validEvidence();
  const observation = evidence.observations[0];
  assert.ok(observation);
  observation.videoSha256 = "https://example.invalid/video";
  observation.screenshotSha256s = [];

  const result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("videoSha256")));
  assert.ok(result.errors.some((error) => error.includes("screenshotSha256s")));
});

test("a linked friction is valid evidence but keeps the closure gate red", () => {
  const evidence = validEvidence();
  const observation = evidence.observations[0];
  assert.ok(observation);
  observation.outcome = "FRICTION";
  observation.frictions = [
    {
      severity: "P1",
      summary: "A ação primária não fica distinguível no viewport principal.",
      issueUrl: "https://github.com/tjsasakifln/Governance/issues/999",
      acceptanceCriteria: ["A ação primária é identificada em até três segundos."],
    },
  ];

  const result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, true);
  assert.equal(result.auditPassed, false);
  assert.ok(result.gateFailures.some((failure) => failure.includes("ended as FRICTION")));
});

test("frictions cannot remain only in comments or media", () => {
  const evidence = validEvidence();
  const observation = evidence.observations[0];
  assert.ok(observation);
  observation.outcome = "BLOCKED";
  observation.firstActionMs = null;
  observation.frictions = [
    {
      severity: "P0",
      summary: "Operador não consegue autenticar.",
      issueUrl: "video-only",
      acceptanceCriteria: [],
    },
  ];

  const result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("numbered Governance issue")));
  assert.ok(result.errors.some((error) => error.includes("acceptanceCriteria")));
});

test("three-second orientation budget is a closure gate, not forged evidence", () => {
  const evidence = validEvidence();
  const observation = evidence.observations[0];
  assert.ok(observation);
  observation.orientationMs = 3_001;
  observation.firstActionMs = 4_500;

  const result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, true);
  assert.equal(result.auditPassed, false);
  assert.ok(result.gateFailures.some((failure) => failure.includes("exceeded the 3000ms")));
});

test("PASS cannot conceal recorded frictions or impossible timing", () => {
  const evidence = validEvidence();
  const observation = evidence.observations[0];
  assert.ok(observation);
  observation.firstActionMs = 1_000;
  observation.frictions = [
    {
      severity: "P2",
      summary: "Texto secundário ambíguo.",
      issueUrl: "https://github.com/tjsasakifln/Governance/issues/998",
      acceptanceCriteria: ["Texto secundário distingue estado e ação."],
    },
  ];

  const result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("may not be earlier")));
  assert.ok(result.errors.some((error) => error.includes("cannot be PASS")));
});
