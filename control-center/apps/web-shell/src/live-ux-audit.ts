import {
  COMMERCIAL_SURFACES,
  DESTINATIONS,
  WARMBLY_SURFACES,
  getDestination,
} from "./destinations";

export const LIVE_UX_AUDIT_SCHEMA = "confenge.live-ux-audit.v1" as const;
export const LIVE_UX_AUDIT_ORIGIN = "https://ops.confenge.com.br" as const;
export const RUNTIME_IDENTITY_SCHEMA = "control-center.runtime-identity.v1" as const;
export const LIVE_UX_REQUIRED_RUNTIME_BASELINE_SHA = "64ece7d38abacd3adeaa02735b4f22af66caab0f" as const;

export const VIEWPORTS = [
  {
    id: "primary-mobile",
    label: "Mobile principal (uso com uma mão)",
    width: 390,
    height: 844,
    inputMode: "ONE_HANDED_TOUCH",
  },
  {
    id: "secondary-desktop",
    label: "Desktop complementar",
    minWidth: 1280,
    minHeight: 720,
    inputMode: "DESKTOP_POINTER_KEYBOARD",
  },
] as const;

export type ViewportId = (typeof VIEWPORTS)[number]["id"];

export interface AuditRoute {
  readonly key: string;
  readonly path: string;
  readonly label: string;
}

const destinationRoutes: readonly AuditRoute[] = DESTINATIONS.map((destination) => ({
  key: `destination:${destination.id}`,
  path: destination.path,
  label: destination.label,
}));

const commercialRoot = getDestination("comercial").path;
const commercialRoutes: readonly AuditRoute[] = COMMERCIAL_SURFACES.map((surface) => ({
  key: `commercial:${surface}`,
  path: `${commercialRoot}/${surface}`,
  label: `Comercial / ${surface}`,
}));

const warmblyRoot = getDestination("warmbly").path;
const warmblyRoutes: readonly AuditRoute[] = WARMBLY_SURFACES.map((surface) => ({
  key: `warmbly:${surface}`,
  path: `${warmblyRoot}/${surface}`,
  label: `Operação Warmbly / ${surface}`,
}));

/**
 * This inventory is intentionally derived from the navigation registries.
 * Adding a destination or registered sub-surface makes the audit consistency
 * test fail until a journey owns the new route.
 */
export const LIVE_AUDIT_ROUTES: readonly AuditRoute[] = [
  ...destinationRoutes,
  ...commercialRoutes,
  ...warmblyRoutes,
];

export const JOURNEY_IDS = [
  "attention-today",
  "review-approve-next",
  "adjust-hold-reject",
  "inbound-triage",
  "exception-resolution",
  "client-lead-history-return",
  "transversal-without-internal-ids",
  "outbound-state-pause",
  "resume-after-return-reload-reauth",
  "recover-stale-error-permission-unknown",
] as const;

export type JourneyId = (typeof JOURNEY_IDS)[number];

export interface JourneyDefinition {
  readonly id: JourneyId;
  readonly label: string;
  readonly operatorGoal: string;
  readonly requiredRouteKeys: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly relatedIssues: readonly number[];
}

/**
 * The ten minimum journeys from Governance #111. Route ownership is explicit
 * so that the registry-derived coverage check cannot silently ignore a page.
 */
export const LIVE_AUDIT_JOURNEYS: readonly JourneyDefinition[] = [
  {
    id: "attention-today",
    label: "Entender o que exige atenção hoje",
    operatorGoal: "Orientar-se em até três segundos e escolher a primeira ação segura.",
    requiredRouteKeys: ["destination:hoje"],
    requiredChecks: ["orientation", "urgency", "next-safe-action"],
    relatedIssues: [106, 107, 110, 112, 113, 115, 116],
  },
  {
    id: "review-approve-next",
    label: "Revisar a fila, aprovar e seguir para o próximo item",
    operatorGoal: "Concluir a revisão humana sem perder contexto entre itens.",
    requiredRouteKeys: ["warmbly:revisao"],
    requiredChecks: ["open-review-queue", "approve-once", "advance-with-context"],
    relatedIssues: [110, 112, 113, 115],
  },
  {
    id: "adjust-hold-reject",
    label: "Ajustar, colocar em HOLD ou rejeitar",
    operatorGoal: "Distinguir as três decisões e confirmar seu efeito antes da mutação.",
    requiredRouteKeys: ["warmbly:revisao", "warmbly:operacao"],
    requiredChecks: ["adjust", "hold", "reject"],
    relatedIssues: [110, 112, 113, 115],
  },
  {
    id: "inbound-triage",
    label: "Triar o inbound sem inventar atribuição",
    operatorGoal: "Localizar sinal, proveniência e próxima ação do inbound.",
    requiredRouteKeys: ["destination:crescimento", "commercial:cohorts"],
    requiredChecks: ["find-inbound", "read-provenance", "choose-next-action"],
    relatedIssues: [106, 107, 110, 116],
  },
  {
    id: "exception-resolution",
    label: "Resolver uma exceção operacional",
    operatorGoal: "Compreender causa, autoridade e ação de recuperação segura.",
    requiredRouteKeys: ["commercial:excecoes"],
    requiredChecks: ["find-exception", "understand-cause", "recover-safely"],
    relatedIssues: [107, 110, 112, 113, 114, 115],
  },
  {
    id: "client-lead-history-return",
    label: "Localizar cliente ou lead, consultar histórico e voltar",
    operatorGoal: "Navegar ida e volta preservando o recorte e a posição de trabalho.",
    requiredRouteKeys: [
      "destination:clientes",
      "commercial:atividade",
      "commercial:pipeline",
    ],
    requiredChecks: ["find-client-or-lead", "read-history", "return-with-context"],
    relatedIssues: [106, 107, 110, 116],
  },
  {
    id: "transversal-without-internal-ids",
    label: "Consultar domínios transversais sem conhecer IDs internos",
    operatorGoal: "Encontrar informação por linguagem operacional e proveniência visível.",
    requiredRouteKeys: [
      "destination:financeiro",
      "destination:engenharia",
      "destination:infra",
      "destination:agentes",
    ],
    requiredChecks: ["finance", "engineering", "infrastructure", "agents", "no-internal-id-needed"],
    relatedIssues: [106, 107, 110, 116],
  },
  {
    id: "outbound-state-pause",
    label: "Entender o estado do outbound e pausá-lo com segurança",
    operatorGoal: "Ver estado, janela e limites antes de uma pausa reversível.",
    requiredRouteKeys: [
      "destination:warmbly",
      "warmbly:operacao",
      "warmbly:cohorts",
    ],
    requiredChecks: ["read-outbound-state", "read-window-and-limits", "start-safe-pause"],
    relatedIssues: [107, 110, 112, 113, 115],
  },
  {
    id: "resume-after-return-reload-reauth",
    label: "Retomar a tarefa após voltar, recarregar ou reautenticar",
    operatorGoal: "Recuperar contexto e decisão sem depender de memória da arquitetura.",
    requiredRouteKeys: ["destination:memoria"],
    requiredChecks: ["return", "reload", "reauthenticate"],
    relatedIssues: [106, 107, 110, 116],
  },
  {
    id: "recover-stale-error-permission-unknown",
    label: "Recuperar-se de stale, erro, permissão ou estado desconhecido",
    operatorGoal: "Distinguir o estado e encontrar uma recuperação acionável e segura.",
    requiredRouteKeys: [
      "destination:comercial",
      "commercial:visao",
      "commercial:rascunhos",
    ],
    requiredChecks: ["stale", "error", "permission-denied", "unknown-outcome"],
    relatedIssues: [106, 107, 110, 112, 113, 114, 115, 116],
  },
] as const;

export interface AuditPlan {
  readonly schemaVersion: typeof LIVE_UX_AUDIT_SCHEMA;
  readonly status: "NOT_EXECUTED";
  readonly warning: string;
  readonly origin: typeof LIVE_UX_AUDIT_ORIGIN;
  readonly routes: readonly AuditRoute[];
  readonly journeys: readonly JourneyDefinition[];
  readonly viewports: typeof VIEWPORTS;
  readonly consistencyErrors: readonly string[];
  readonly protocol: readonly string[];
}

export function auditPlanConsistencyErrors(): readonly string[] {
  const errors: string[] = [];
  const routeKeys = new Set(LIVE_AUDIT_ROUTES.map((route) => route.key));
  const assigned = new Set<string>();

  for (const journey of LIVE_AUDIT_JOURNEYS) {
    if (
      journey.requiredRouteKeys.length === 0 ||
      new Set(journey.requiredRouteKeys).size !== journey.requiredRouteKeys.length
    ) {
      errors.push(`Journey ${journey.id} must own at least one route, without duplicates.`);
    }
    if (
      journey.requiredChecks.length === 0 ||
      new Set(journey.requiredChecks).size !== journey.requiredChecks.length
    ) {
      errors.push(`Journey ${journey.id} must define at least one required check, without duplicates.`);
    }
    for (const routeKey of journey.requiredRouteKeys) {
      if (!routeKeys.has(routeKey)) {
        errors.push(`Journey ${journey.id} references unknown route ${routeKey}.`);
      }
      assigned.add(routeKey);
    }
  }

  for (const route of LIVE_AUDIT_ROUTES) {
    if (!assigned.has(route.key)) {
      errors.push(`Route ${route.key} (${route.path}) has no live audit journey.`);
    }
  }

  if (new Set(LIVE_AUDIT_ROUTES.map((route) => route.path)).size !== LIVE_AUDIT_ROUTES.length) {
    errors.push("The live audit route inventory contains duplicate paths.");
  }
  if (new Set(LIVE_AUDIT_ROUTES.map((route) => route.key)).size !== LIVE_AUDIT_ROUTES.length) {
    errors.push("The live audit route inventory contains duplicate keys.");
  }
  if (new Set(LIVE_AUDIT_JOURNEYS.map((journey) => journey.id)).size !== JOURNEY_IDS.length) {
    errors.push("The live audit journey inventory contains duplicate or missing IDs.");
  }

  return errors;
}

export function buildLiveUxAuditPlan(): AuditPlan {
  return {
    schemaVersion: LIVE_UX_AUDIT_SCHEMA,
    status: "NOT_EXECUTED",
    warning:
      "This plan is not evidence and does not approve UX. A human external operator must execute it against the authenticated live origin.",
    origin: LIVE_UX_AUDIT_ORIGIN,
    routes: LIVE_AUDIT_ROUTES,
    journeys: LIVE_AUDIT_JOURNEYS,
    viewports: VIEWPORTS,
    consistencyErrors: auditPlanConsistencyErrors(),
    protocol: [
      "Use a skeptical external human operator with no architecture memory.",
      "Execute every journey at 390x844 and repeat it on a complementary desktop viewport.",
      "Allow exactly three seconds for initial orientation.",
      "Use sanitized data; never send real email, issue GO, resume outbound, or perform an irreversible action.",
      "Copy the pinned production identities from /runtime-identity and /v1/runtime-identity; both must name the same release SHA and baseline.",
      "Record distinct video and screenshot artifacts plus every required check, orientation time, first-action time, steps, and outcome.",
      "Open or complement an issue for every friction; a P0/P1 finding may not remain only in media, comments, or documents.",
    ],
  };
}

export type AuditOutcome = "PASS" | "FRICTION" | "BLOCKED";
export type FrictionSeverity = "P0" | "P1" | "P2" | "P3";

export interface AuditValidationResult {
  readonly valid: boolean;
  readonly uxCriteriaPassed: boolean;
  readonly auditPassed: boolean;
  readonly errors: readonly string[];
  readonly gateFailures: readonly string[];
}

type JsonObject = Record<string, unknown>;

const fullShaPattern = /^[0-9a-f]{40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const governanceIssuePattern = /^https:\/\/github\.com\/tjsasakifln\/Governance\/issues\/[1-9][0-9]*$/;
const rfc3339Pattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const cpfPattern = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;
const cnpjPattern = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/;
const phonePattern = /(?:\+?55[\s().-]*)?(?:\(?\d{2}\)?[\s.-]*)?9?\d{4}[\s.-]*\d{4}/;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function unexpectedKeys(
  value: JsonObject,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) errors.push(`${path}.${key} is not allowed.`);
  }
}

function isValidRfc3339(value: string): boolean {
  const match = rfc3339Pattern.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (
    month < 1 || month > 12 || day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 || minute > 59 || second > 59
  ) return false;
  if (zone !== undefined && zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function containsSensitiveLiteral(value: string): boolean {
  return emailPattern.test(value) || cpfPattern.test(value) || cnpjPattern.test(value) || phonePattern.test(value);
}

function validateSanitizedText(
  value: unknown,
  path: string,
  errors: string[],
  maxLength = 500,
): value is string {
  if (!isNonEmptyString(value)) {
    errors.push(`${path} is required.`);
    return false;
  }
  if (value.length > maxLength) errors.push(`${path} exceeds ${maxLength} characters.`);
  if (containsSensitiveLiteral(value)) {
    errors.push(`${path} contains an email, CPF/CNPJ, or phone-like literal; use sanitized fixture language.`);
  }
  return true;
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) return null;
  return value;
}

function exactMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((item) => actual.includes(item));
}

function validateRuntimeIdentity(
  value: unknown,
  expectedService: "control-center-web" | "control-center-context",
  runtimeSha: string,
  path: string,
  errors: string[],
): string | null {
  if (!isObject(value)) {
    errors.push(`${path} must be an object copied from the live runtime identity endpoint.`);
    return null;
  }
  unexpectedKeys(value, [
    "schema_version",
    "service",
    "release_sha",
    "required_baseline_sha",
    "release_status",
    "production_required",
  ], path, errors);
  if (value.schema_version !== RUNTIME_IDENTITY_SCHEMA) {
    errors.push(`${path}.schema_version must be ${RUNTIME_IDENTITY_SCHEMA}.`);
  }
  if (value.service !== expectedService) errors.push(`${path}.service must be ${expectedService}.`);
  if (value.release_sha !== runtimeSha || !isNonEmptyString(value.release_sha) || !fullShaPattern.test(value.release_sha)) {
    errors.push(`${path}.release_sha must exactly match environment.runtimeSha.`);
  }
  if (value.release_status !== "PINNED") errors.push(`${path}.release_status must be PINNED.`);
  if (value.production_required !== true) errors.push(`${path}.production_required must be true.`);
  if (
    !isNonEmptyString(value.required_baseline_sha) ||
    !fullShaPattern.test(value.required_baseline_sha)
  ) {
    errors.push(`${path}.required_baseline_sha must be a full lowercase 40-character Git SHA.`);
    return null;
  }
  if (value.required_baseline_sha !== LIVE_UX_REQUIRED_RUNTIME_BASELINE_SHA) {
    errors.push(`${path}.required_baseline_sha must match the audit contract baseline.`);
  }
  return value.required_baseline_sha;
}

function validateViewport(
  value: unknown,
  expectedId: ViewportId,
  path: string,
  errors: string[],
): void {
  if (!isObject(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  unexpectedKeys(value, ["id", "width", "height", "inputMode"], path, errors);
  if (value.id !== expectedId) {
    errors.push(`${path}.id must be ${expectedId}.`);
  }
  if (expectedId === "primary-mobile") {
    if (value.width !== 390 || value.height !== 844) {
      errors.push(`${path} must record the exact 390x844 primary viewport.`);
    }
    if (value.inputMode !== "ONE_HANDED_TOUCH") {
      errors.push(`${path}.inputMode must attest ONE_HANDED_TOUCH.`);
    }
    return;
  }
  if (!isNonNegativeInteger(value.width) || value.width < 1280) {
    errors.push(`${path}.width must be at least 1280 for the complementary desktop run.`);
  }
  if (!isNonNegativeInteger(value.height) || value.height < 720) {
    errors.push(`${path}.height must be at least 720 for the complementary desktop run.`);
  }
  if (value.inputMode !== "DESKTOP_POINTER_KEYBOARD") {
    errors.push(`${path}.inputMode must attest DESKTOP_POINTER_KEYBOARD.`);
  }
}

function validateFriction(
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (!isObject(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  unexpectedKeys(value, ["severity", "summary", "issueUrl", "acceptanceCriteria"], path, errors);
  if (!["P0", "P1", "P2", "P3"].includes(String(value.severity))) {
    errors.push(`${path}.severity must be P0, P1, P2, or P3.`);
  }
  validateSanitizedText(value.summary, `${path}.summary`, errors);
  if (!isNonEmptyString(value.issueUrl) || !governanceIssuePattern.test(value.issueUrl)) {
    errors.push(`${path}.issueUrl must point to a numbered Governance issue.`);
  }
  const acceptanceCriteria = stringArray(value.acceptanceCriteria);
  if (!acceptanceCriteria || acceptanceCriteria.length === 0) {
    errors.push(`${path}.acceptanceCriteria must contain at least one verifiable criterion.`);
  } else {
    if (acceptanceCriteria.length > 20) errors.push(`${path}.acceptanceCriteria may contain at most 20 items.`);
    acceptanceCriteria.forEach((criterion, index) => {
      validateSanitizedText(criterion, `${path}.acceptanceCriteria[${index}]`, errors);
    });
  }
}

function registerMediaDigest(
  value: unknown,
  path: string,
  errors: string[],
  seenMediaDigests: Map<string, string>,
): void {
  if (!isNonEmptyString(value) || !sha256Pattern.test(value)) {
    errors.push(`${path} must be a lowercase SHA-256 digest.`);
    return;
  }
  const firstPath = seenMediaDigests.get(value);
  if (firstPath) {
    errors.push(`${path} reuses the media digest already recorded by ${firstPath}.`);
    return;
  }
  seenMediaDigests.set(value, path);
}

function validateObservation(
  value: unknown,
  journey: JourneyDefinition,
  viewportId: ViewportId,
  runtimeSha: string,
  path: string,
  errors: string[],
  gateFailures: string[],
  seenMediaDigests: Map<string, string>,
): void {
  if (!isObject(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  unexpectedKeys(value, [
    "journeyId",
    "viewport",
    "routeKeys",
    "checks",
    "runtimeSha",
    "sanitizedData",
    "steps",
    "orientationMs",
    "firstActionMs",
    "outcome",
    "videoSha256",
    "screenshotSha256s",
    "frictions",
  ], path, errors);

  if (value.journeyId !== journey.id) {
    errors.push(`${path}.journeyId must be ${journey.id}.`);
  }
  validateViewport(value.viewport, viewportId, `${path}.viewport`, errors);

  const routeKeys = stringArray(value.routeKeys);
  if (!routeKeys || !exactMembers(routeKeys, journey.requiredRouteKeys)) {
    errors.push(`${path}.routeKeys must contain every route assigned to ${journey.id}, exactly once.`);
  }

  const checkOutcomes = new Map<string, AuditOutcome>();
  if (!Array.isArray(value.checks)) {
    errors.push(`${path}.checks must be an array.`);
  } else {
    value.checks.forEach((check, index) => {
      const checkPath = `${path}.checks[${index}]`;
      if (!isObject(check)) {
        errors.push(`${checkPath} must be an object.`);
        return;
      }
      unexpectedKeys(check, ["id", "outcome"], checkPath, errors);
      if (!isNonEmptyString(check.id) || !journey.requiredChecks.includes(check.id)) {
        errors.push(`${checkPath}.id must identify a required check for ${journey.id}.`);
        return;
      }
      if (checkOutcomes.has(check.id)) {
        errors.push(`${checkPath}.id duplicates ${check.id}.`);
        return;
      }
      if (!["PASS", "FRICTION", "BLOCKED"].includes(String(check.outcome))) {
        errors.push(`${checkPath}.outcome must be PASS, FRICTION, or BLOCKED.`);
        return;
      }
      checkOutcomes.set(check.id, check.outcome as AuditOutcome);
    });
    if (!exactMembers([...checkOutcomes.keys()], journey.requiredChecks)) {
      errors.push(`${path}.checks must report every required check for ${journey.id}, exactly once.`);
    }
  }
  if (value.runtimeSha !== runtimeSha) {
    errors.push(`${path}.runtimeSha must match environment.runtimeSha.`);
  }
  if (value.sanitizedData !== true) {
    errors.push(`${path}.sanitizedData must be true.`);
  }

  const steps = stringArray(value.steps);
  if (!steps || steps.length === 0) {
    errors.push(`${path}.steps must record at least one sanitized operator step.`);
  } else {
    if (steps.length > 100) errors.push(`${path}.steps may contain at most 100 items.`);
    steps.forEach((step, index) => validateSanitizedText(step, `${path}.steps[${index}]`, errors));
  }
  if (!isNonNegativeInteger(value.orientationMs)) {
    errors.push(`${path}.orientationMs must be a non-negative integer.`);
  } else if (value.orientationMs > 3_000) {
    gateFailures.push(`${journey.id}/${viewportId} exceeded the 3000ms orientation budget.`);
  }

  const outcome = value.outcome;
  if (!["PASS", "FRICTION", "BLOCKED"].includes(String(outcome))) {
    errors.push(`${path}.outcome must be PASS, FRICTION, or BLOCKED.`);
  } else if (outcome !== "PASS") {
    gateFailures.push(`${journey.id}/${viewportId} ended as ${String(outcome)}.`);
  }
  if (checkOutcomes.size === journey.requiredChecks.length) {
    const expectedOutcome: AuditOutcome = [...checkOutcomes.values()].includes("BLOCKED")
      ? "BLOCKED"
      : [...checkOutcomes.values()].includes("FRICTION")
        ? "FRICTION"
        : "PASS";
    if (outcome !== expectedOutcome) {
      errors.push(`${path}.outcome must be ${expectedOutcome} to match its required check outcomes.`);
    }
  }

  if (outcome === "BLOCKED") {
    if (value.firstActionMs !== null && !isNonNegativeInteger(value.firstActionMs)) {
      errors.push(`${path}.firstActionMs must be null or a non-negative integer when blocked.`);
    }
  } else if (!isNonNegativeInteger(value.firstActionMs)) {
    errors.push(`${path}.firstActionMs must be a non-negative integer.`);
  }
  if (
    isNonNegativeInteger(value.firstActionMs) &&
    isNonNegativeInteger(value.orientationMs) &&
    value.firstActionMs < value.orientationMs
  ) {
    errors.push(`${path}.firstActionMs may not be earlier than orientationMs.`);
  }

  registerMediaDigest(value.videoSha256, `${path}.videoSha256`, errors, seenMediaDigests);
  const screenshotSha256s = stringArray(value.screenshotSha256s);
  if (
    !screenshotSha256s ||
    screenshotSha256s.length === 0 ||
    screenshotSha256s.some((digest) => !sha256Pattern.test(digest))
  ) {
    errors.push(`${path}.screenshotSha256s must contain lowercase SHA-256 digests.`);
  } else {
    if (screenshotSha256s.length > 20) errors.push(`${path}.screenshotSha256s may contain at most 20 items.`);
    screenshotSha256s.forEach((digest, index) => {
      registerMediaDigest(digest, `${path}.screenshotSha256s[${index}]`, errors, seenMediaDigests);
    });
  }

  if (!Array.isArray(value.frictions)) {
    errors.push(`${path}.frictions must be an array.`);
  } else {
    value.frictions.forEach((friction, index) => {
      validateFriction(friction, `${path}.frictions[${index}]`, errors);
    });
    if (outcome === "PASS" && value.frictions.length > 0) {
      errors.push(`${path} cannot be PASS while recording frictions.`);
    }
    if ((outcome === "FRICTION" || outcome === "BLOCKED") && value.frictions.length === 0) {
      errors.push(`${path} must link at least one friction issue when it is not PASS.`);
    }
  }
}

/**
 * Validates provenance/completeness separately from the actual UX pass gate.
 * A truthful FRICTION/BLOCKED manifest can be structurally valid, but it can
 * never make `auditPassed` true or close the live audit.
 */
export function validateLiveUxAudit(value: unknown, nowMs = Date.now()): AuditValidationResult {
  const errors = [...auditPlanConsistencyErrors()];
  const gateFailures: string[] = [];

  if (!isObject(value)) {
    return {
      valid: false,
      uxCriteriaPassed: false,
      auditPassed: false,
      errors: [...errors, "Audit evidence must be a JSON object."],
      gateFailures,
    };
  }
  unexpectedKeys(value, [
    "schemaVersion",
    "executionMode",
    "environment",
    "operator",
    "safety",
    "observations",
  ], "evidence", errors);

  if (value.schemaVersion !== LIVE_UX_AUDIT_SCHEMA) {
    errors.push(`schemaVersion must be ${LIVE_UX_AUDIT_SCHEMA}.`);
  }
  if (value.executionMode !== "HUMAN_AUTHENTICATED_LIVE") {
    errors.push("executionMode must be HUMAN_AUTHENTICATED_LIVE; automation is not a substitute.");
  }

  let runtimeSha = "";
  if (!isObject(value.environment)) {
    errors.push("environment must be an object.");
  } else {
    unexpectedKeys(value.environment, [
      "origin",
      "runtimeSha",
      "capturedAt",
      "webRuntimeIdentity",
      "contextRuntimeIdentity",
    ], "environment", errors);
    if (value.environment.origin !== LIVE_UX_AUDIT_ORIGIN) {
      errors.push(`environment.origin must be ${LIVE_UX_AUDIT_ORIGIN}.`);
    }
    if (!isNonEmptyString(value.environment.runtimeSha) || !fullShaPattern.test(value.environment.runtimeSha)) {
      errors.push("environment.runtimeSha must be a full lowercase 40-character Git SHA.");
    } else {
      runtimeSha = value.environment.runtimeSha;
    }
    if (!isNonEmptyString(value.environment.capturedAt) || !isValidRfc3339(value.environment.capturedAt)) {
      errors.push("environment.capturedAt must be a real RFC 3339 calendar timestamp with timezone.");
    } else if (Date.parse(value.environment.capturedAt) > nowMs + 5 * 60 * 1_000) {
      errors.push("environment.capturedAt may not be more than five minutes in the future.");
    }
    const webBaseline = validateRuntimeIdentity(
      value.environment.webRuntimeIdentity,
      "control-center-web",
      runtimeSha,
      "environment.webRuntimeIdentity",
      errors,
    );
    const contextBaseline = validateRuntimeIdentity(
      value.environment.contextRuntimeIdentity,
      "control-center-context",
      runtimeSha,
      "environment.contextRuntimeIdentity",
      errors,
    );
    if (webBaseline !== null && contextBaseline !== null && webBaseline !== contextBaseline) {
      errors.push("web and context runtime identities must report the same required_baseline_sha.");
    }
  }

  if (!isObject(value.operator)) {
    errors.push("operator must be an object.");
  } else {
    unexpectedKeys(value.operator, ["pseudonym", "role", "human", "independent"], "operator", errors);
    if (
      !isNonEmptyString(value.operator.pseudonym) ||
      value.operator.pseudonym.includes("@") ||
      value.operator.pseudonym.length > 80
    ) {
      errors.push("operator.pseudonym must be a non-email pseudonym of at most 80 characters.");
    } else if (containsSensitiveLiteral(value.operator.pseudonym)) {
      errors.push("operator.pseudonym contains a sensitive literal.");
    }
    validateSanitizedText(value.operator.role, "operator.role", errors, 120);
    if (value.operator.human !== true || value.operator.independent !== true) {
      errors.push("operator must attest human=true and independent=true.");
    }
  }

  if (!isObject(value.safety)) {
    errors.push("safety must be an object.");
  } else {
    unexpectedKeys(value.safety, [
      "syntheticDataOnly",
      "realEmailSent",
      "goIssued",
      "outboundResumed",
      "irreversibleAction",
    ], "safety", errors);
    if (value.safety.syntheticDataOnly !== true) {
      errors.push("safety.syntheticDataOnly must be true.");
    }
    for (const forbidden of [
      "realEmailSent",
      "goIssued",
      "outboundResumed",
      "irreversibleAction",
    ] as const) {
      if (value.safety[forbidden] !== false) {
        errors.push(`safety.${forbidden} must be false.`);
      }
    }
  }

  const observations = Array.isArray(value.observations) ? value.observations : [];
  if (!Array.isArray(value.observations)) {
    errors.push("observations must be an array.");
  }

  const expectedPairs = new Map<string, { journey: JourneyDefinition; viewportId: ViewportId }>();
  for (const journey of LIVE_AUDIT_JOURNEYS) {
    for (const viewport of VIEWPORTS) {
      expectedPairs.set(`${journey.id}/${viewport.id}`, { journey, viewportId: viewport.id });
    }
  }

  const seenPairs = new Set<string>();
  const seenMediaDigests = new Map<string, string>();
  observations.forEach((observation, index) => {
    const path = `observations[${index}]`;
    if (!isObject(observation)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    const pairKey = `${String(observation.journeyId)}/${
      isObject(observation.viewport) ? String(observation.viewport.id) : "undefined"
    }`;
    const expected = expectedPairs.get(pairKey);
    if (!expected) {
      errors.push(`${path} identifies an unknown journey/viewport pair (${pairKey}).`);
      return;
    }
    if (seenPairs.has(pairKey)) {
      errors.push(`${path} duplicates journey/viewport pair ${pairKey}.`);
      return;
    }
    seenPairs.add(pairKey);
    validateObservation(
      observation,
      expected.journey,
      expected.viewportId,
      runtimeSha,
      path,
      errors,
      gateFailures,
      seenMediaDigests,
    );
  });

  for (const pairKey of expectedPairs.keys()) {
    if (!seenPairs.has(pairKey)) {
      errors.push(`Missing required observation ${pairKey}.`);
    }
  }

  const valid = errors.length === 0;
  const uxCriteriaPassed = valid && gateFailures.length === 0;
  return {
    valid,
    uxCriteriaPassed,
    // Structural JSON alone cannot prove that its media digests resolve to
    // recordings. Only the CLI gate may promote this to true after hashing the
    // authorized evidence directory and resolving every finding issue.
    auditPassed: false,
    errors,
    gateFailures,
  };
}

/** Returns the content identities that the CLI gate must resolve to real files. */
export function liveUxAuditMediaDigests(value: unknown): readonly string[] {
  if (!isObject(value) || !Array.isArray(value.observations)) return [];
  const digests: string[] = [];
  for (const observation of value.observations) {
    if (!isObject(observation)) continue;
    if (isNonEmptyString(observation.videoSha256) && sha256Pattern.test(observation.videoSha256)) {
      digests.push(observation.videoSha256);
    }
    if (Array.isArray(observation.screenshotSha256s)) {
      for (const digest of observation.screenshotSha256s) {
        if (isNonEmptyString(digest) && sha256Pattern.test(digest)) digests.push(digest);
      }
    }
  }
  return digests;
}

/** Returns referenced findings so the CLI can prove they are real issues, not invented URLs. */
export function liveUxAuditIssueNumbers(value: unknown): readonly number[] {
  if (!isObject(value) || !Array.isArray(value.observations)) return [];
  const issueNumbers = new Set<number>();
  for (const observation of value.observations) {
    if (!isObject(observation) || !Array.isArray(observation.frictions)) continue;
    for (const friction of observation.frictions) {
      if (!isObject(friction) || !isNonEmptyString(friction.issueUrl)) continue;
      if (!governanceIssuePattern.test(friction.issueUrl)) continue;
      const issueNumber = Number(friction.issueUrl.slice(friction.issueUrl.lastIndexOf("/") + 1));
      if (Number.isSafeInteger(issueNumber) && issueNumber > 0) issueNumbers.add(issueNumber);
    }
  }
  return [...issueNumbers].sort((left, right) => left - right);
}
