import assert from "node:assert/strict";
import { test } from "node:test";
import {
  JOURNEY_IDS,
  LIVE_AUDIT_JOURNEYS,
  LIVE_AUDIT_ROUTES,
  LIVE_UX_AUDIT_ORIGIN,
  LIVE_UX_AUDIT_SCHEMA,
  LIVE_UX_REQUIRED_RUNTIME_BASELINE_SHA,
  VIEWPORTS,
  auditPlanConsistencyErrors,
  buildLiveUxAuditPlan,
  liveUxAuditIssueNumbers,
  liveUxAuditMediaDigests,
  validateLiveUxAudit,
} from "../src/live-ux-audit";

const runtimeSha = "a".repeat(40);
const baselineSha = LIVE_UX_REQUIRED_RUNTIME_BASELINE_SHA;

function mediaSha(index: number): string {
  return index.toString(16).padStart(64, "0");
}

interface MutableObservation {
  journeyId: string;
  viewport: { id: string; width: number; height: number; inputMode: string };
  routeKeys: string[];
  checks: Array<{ id: string; outcome: string }>;
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
  environment: {
    origin: string;
    runtimeSha: string;
    capturedAt: string;
    webRuntimeIdentity: Record<string, unknown>;
    contextRuntimeIdentity: Record<string, unknown>;
  };
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
      capturedAt: "2020-08-25T14:30:00-03:00",
      webRuntimeIdentity: {
        schema_version: "control-center.runtime-identity.v1",
        service: "control-center-web",
        release_sha: runtimeSha,
        required_baseline_sha: baselineSha,
        release_status: "PINNED",
        production_required: true,
      },
      contextRuntimeIdentity: {
        schema_version: "control-center.runtime-identity.v1",
        service: "control-center-context",
        release_sha: runtimeSha,
        required_baseline_sha: baselineSha,
        release_status: "PINNED",
        production_required: true,
      },
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
    observations: LIVE_AUDIT_JOURNEYS.flatMap((journey, journeyIndex) =>
      VIEWPORTS.map((viewport, viewportIndex): MutableObservation => {
        const mediaIndex = journeyIndex * VIEWPORTS.length * 2 + viewportIndex * 2;
        return {
          journeyId: journey.id,
          viewport:
            viewport.id === "primary-mobile"
              ? { id: viewport.id, width: viewport.width, height: viewport.height, inputMode: viewport.inputMode }
              : { id: viewport.id, width: viewport.minWidth, height: viewport.minHeight, inputMode: viewport.inputMode },
          routeKeys: [...journey.requiredRouteKeys],
          checks: journey.requiredChecks.map((id) => ({ id, outcome: "PASS" })),
          runtimeSha,
          sanitizedData: true,
          steps: ["Abrir a rota", "Identificar o estado", "Escolher a ação segura"],
          orientationMs: 2_500,
          firstActionMs: 4_000,
          outcome: "PASS",
          videoSha256: mediaSha(mediaIndex + 1),
          screenshotSha256s: [mediaSha(mediaIndex + 2)],
          frictions: [],
        };
      }),
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

test("complete manifest passes UX criteria but cannot self-approve without media", () => {
  const result = validateLiveUxAudit(validEvidence());
  assert.deepEqual(result, {
    valid: true,
    uxCriteriaPassed: true,
    auditPassed: false,
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
  mobile.viewport.inputMode = "DESKTOP_POINTER_KEYBOARD";
  desktop.viewport.width = 1_024;

  const result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("exact 390x844")));
  assert.ok(result.errors.some((error) => error.includes("ONE_HANDED_TOUCH")));
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

test("both production runtime identity endpoints must pin the audited release", () => {
  const evidence = validEvidence();
  evidence.environment.webRuntimeIdentity.release_sha = "d".repeat(40);
  evidence.environment.contextRuntimeIdentity.production_required = false;
  evidence.environment.contextRuntimeIdentity.required_baseline_sha = "e".repeat(40);

  const result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("webRuntimeIdentity.release_sha")));
  assert.ok(result.errors.some((error) => error.includes("production_required must be true")));
  assert.ok(result.errors.some((error) => error.includes("same required_baseline_sha")));
});

test("capturedAt rejects normalized calendar dates and future evidence", () => {
  const evidence = validEvidence();
  evidence.environment.capturedAt = "2026-02-31T12:00:00Z";
  let result = validateLiveUxAudit(evidence, Date.parse("2026-03-10T12:00:00Z"));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("real RFC 3339 calendar")));

  evidence.environment.capturedAt = "2026-03-10T12:06:00Z";
  result = validateLiveUxAudit(evidence, Date.parse("2026-03-10T12:00:00Z"));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("five minutes in the future")));
});

test("required scenario checks cannot be skipped or contradict the journey outcome", () => {
  const evidence = validEvidence();
  const recovery = evidence.observations.find(
    (observation) =>
      observation.journeyId === "recover-stale-error-permission-unknown" &&
      observation.viewport.id === "primary-mobile",
  );
  assert.ok(recovery);
  recovery.checks.pop();
  recovery.checks[0]!.outcome = "BLOCKED";

  let result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("must report every required check")));

  const contradictoryEvidence = validEvidence();
  const contradictoryRecovery = contradictoryEvidence.observations.find(
    (observation) =>
      observation.journeyId === "recover-stale-error-permission-unknown" &&
      observation.viewport.id === "primary-mobile",
  );
  assert.ok(contradictoryRecovery);
  contradictoryRecovery.checks[0]!.outcome = "BLOCKED";
  result = validateLiveUxAudit(contradictoryEvidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("outcome must be BLOCKED")));
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

test("one placeholder artifact cannot impersonate every recording and screenshot", () => {
  const evidence = validEvidence();
  const first = evidence.observations[0];
  const second = evidence.observations[1];
  assert.ok(first);
  assert.ok(second);
  second.videoSha256 = first.videoSha256;
  second.screenshotSha256s = [first.screenshotSha256s[0]!];

  const result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, false);
  assert.equal(result.errors.filter((error) => error.includes("reuses the media digest")).length, 2);
});

test("the external gate receives every distinct media digest and finding issue", () => {
  const evidence = validEvidence();
  const observation = evidence.observations[0];
  assert.ok(observation);
  observation.outcome = "FRICTION";
  observation.checks[0]!.outcome = "FRICTION";
  observation.frictions = [{
    severity: "P1",
    summary: "A ação primária não fica distinguível no viewport principal.",
    issueUrl: "https://github.com/tjsasakifln/Governance/issues/111",
    acceptanceCriteria: ["A ação primária é identificada em até três segundos."],
  }];

  assert.equal(liveUxAuditMediaDigests(evidence).length, 40);
  assert.deepEqual(liveUxAuditIssueNumbers(evidence), [111]);
});

test("unknown payload fields and obvious personal literals fail closed", () => {
  const evidence = validEvidence() as MutableEvidence & { customerEmail?: string };
  evidence.customerEmail = "real.person@example.com";
  evidence.observations[0]!.steps = ["Ligar para (11) 99999-1234"];

  const result = validateLiveUxAudit(evidence);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("evidence.customerEmail is not allowed")));
  assert.ok(result.errors.some((error) => error.includes("phone-like literal")));
});

test("a linked friction is valid evidence but keeps the closure gate red", () => {
  const evidence = validEvidence();
  const observation = evidence.observations[0];
  assert.ok(observation);
  observation.outcome = "FRICTION";
  observation.checks[0]!.outcome = "FRICTION";
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
  assert.equal(result.uxCriteriaPassed, false);
  assert.equal(result.auditPassed, false);
  assert.ok(result.gateFailures.some((failure) => failure.includes("ended as FRICTION")));
});

test("frictions cannot remain only in comments or media", () => {
  const evidence = validEvidence();
  const observation = evidence.observations[0];
  assert.ok(observation);
  observation.outcome = "BLOCKED";
  observation.checks[0]!.outcome = "BLOCKED";
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
  assert.equal(result.uxCriteriaPassed, false);
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
