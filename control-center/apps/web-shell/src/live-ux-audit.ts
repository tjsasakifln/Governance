import {
  COMMERCIAL_SURFACES,
  DESTINATIONS,
  WARMBLY_SURFACES,
  getDestination,
} from "./destinations";

export const LIVE_UX_AUDIT_SCHEMA = "confenge.live-ux-audit.v1" as const;
export const LIVE_UX_AUDIT_ORIGIN = "https://ops.confenge.com.br" as const;

export const VIEWPORTS = [
  {
    id: "primary-mobile",
    label: "Mobile principal (uso com uma mão)",
    width: 390,
    height: 844,
  },
  {
    id: "secondary-desktop",
    label: "Desktop complementar",
    minWidth: 1280,
    minHeight: 720,
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
    relatedIssues: [106, 107, 110, 112, 113, 115, 116],
  },
  {
    id: "review-approve-next",
    label: "Revisar a fila, aprovar e seguir para o próximo item",
    operatorGoal: "Concluir a revisão humana sem perder contexto entre itens.",
    requiredRouteKeys: ["warmbly:revisao"],
    relatedIssues: [110, 112, 113, 115],
  },
  {
    id: "adjust-hold-reject",
    label: "Ajustar, colocar em HOLD ou rejeitar",
    operatorGoal: "Distinguir as três decisões e confirmar seu efeito antes da mutação.",
    requiredRouteKeys: ["warmbly:revisao", "warmbly:operacao"],
    relatedIssues: [110, 112, 113, 115],
  },
  {
    id: "inbound-triage",
    label: "Triar o inbound sem inventar atribuição",
    operatorGoal: "Localizar sinal, proveniência e próxima ação do inbound.",
    requiredRouteKeys: ["destination:crescimento", "commercial:cohorts"],
    relatedIssues: [106, 107, 110, 116],
  },
  {
    id: "exception-resolution",
    label: "Resolver uma exceção operacional",
    operatorGoal: "Compreender causa, autoridade e ação de recuperação segura.",
    requiredRouteKeys: ["commercial:excecoes"],
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
    relatedIssues: [107, 110, 112, 113, 115],
  },
  {
    id: "resume-after-return-reload-reauth",
    label: "Retomar a tarefa após voltar, recarregar ou reautenticar",
    operatorGoal: "Recuperar contexto e decisão sem depender de memória da arquitetura.",
    requiredRouteKeys: ["destination:memoria"],
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
      "Record video and screenshots plus orientation time, first-action time, steps, outcome, and immutable runtime SHA.",
      "Open or complement an issue for every friction; a P0/P1 finding may not remain only in media, comments, or documents.",
    ],
  };
}

export type AuditOutcome = "PASS" | "FRICTION" | "BLOCKED";
export type FrictionSeverity = "P0" | "P1" | "P2" | "P3";

export interface AuditValidationResult {
  readonly valid: boolean;
  readonly auditPassed: boolean;
  readonly errors: readonly string[];
  readonly gateFailures: readonly string[];
}

type JsonObject = Record<string, unknown>;

const fullShaPattern = /^[0-9a-f]{40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const governanceIssuePattern = /^https:\/\/github\.com\/tjsasakifln\/Governance\/issues\/[1-9][0-9]*$/;
const rfc3339Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
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
  if (value.id !== expectedId) {
    errors.push(`${path}.id must be ${expectedId}.`);
  }
  if (expectedId === "primary-mobile") {
    if (value.width !== 390 || value.height !== 844) {
      errors.push(`${path} must record the exact 390x844 primary viewport.`);
    }
    return;
  }
  if (!isNonNegativeInteger(value.width) || value.width < 1280) {
    errors.push(`${path}.width must be at least 1280 for the complementary desktop run.`);
  }
  if (!isNonNegativeInteger(value.height) || value.height < 720) {
    errors.push(`${path}.height must be at least 720 for the complementary desktop run.`);
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
  if (!["P0", "P1", "P2", "P3"].includes(String(value.severity))) {
    errors.push(`${path}.severity must be P0, P1, P2, or P3.`);
  }
  if (!isNonEmptyString(value.summary)) {
    errors.push(`${path}.summary is required.`);
  }
  if (!isNonEmptyString(value.issueUrl) || !governanceIssuePattern.test(value.issueUrl)) {
    errors.push(`${path}.issueUrl must point to a numbered Governance issue.`);
  }
  const acceptanceCriteria = stringArray(value.acceptanceCriteria);
  if (!acceptanceCriteria || acceptanceCriteria.length === 0) {
    errors.push(`${path}.acceptanceCriteria must contain at least one verifiable criterion.`);
  }
}

function validateObservation(
  value: unknown,
  journey: JourneyDefinition,
  viewportId: ViewportId,
  runtimeSha: string,
  path: string,
  errors: string[],
  gateFailures: string[],
): void {
  if (!isObject(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  if (value.journeyId !== journey.id) {
    errors.push(`${path}.journeyId must be ${journey.id}.`);
  }
  validateViewport(value.viewport, viewportId, `${path}.viewport`, errors);

  const routeKeys = stringArray(value.routeKeys);
  if (!routeKeys || !exactMembers(routeKeys, journey.requiredRouteKeys)) {
    errors.push(`${path}.routeKeys must contain every route assigned to ${journey.id}, exactly once.`);
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

  if (!isNonEmptyString(value.videoSha256) || !sha256Pattern.test(value.videoSha256)) {
    errors.push(`${path}.videoSha256 must be a lowercase SHA-256 digest.`);
  }
  const screenshotSha256s = stringArray(value.screenshotSha256s);
  if (
    !screenshotSha256s ||
    screenshotSha256s.length === 0 ||
    screenshotSha256s.some((digest) => !sha256Pattern.test(digest))
  ) {
    errors.push(`${path}.screenshotSha256s must contain lowercase SHA-256 digests.`);
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
export function validateLiveUxAudit(value: unknown): AuditValidationResult {
  const errors = [...auditPlanConsistencyErrors()];
  const gateFailures: string[] = [];

  if (!isObject(value)) {
    return {
      valid: false,
      auditPassed: false,
      errors: [...errors, "Audit evidence must be a JSON object."],
      gateFailures,
    };
  }

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
    if (value.environment.origin !== LIVE_UX_AUDIT_ORIGIN) {
      errors.push(`environment.origin must be ${LIVE_UX_AUDIT_ORIGIN}.`);
    }
    if (!isNonEmptyString(value.environment.runtimeSha) || !fullShaPattern.test(value.environment.runtimeSha)) {
      errors.push("environment.runtimeSha must be a full lowercase 40-character Git SHA.");
    } else {
      runtimeSha = value.environment.runtimeSha;
    }
    if (!isNonEmptyString(value.environment.capturedAt) || !rfc3339Pattern.test(value.environment.capturedAt)) {
      errors.push("environment.capturedAt must be an RFC 3339 timestamp with timezone.");
    }
  }

  if (!isObject(value.operator)) {
    errors.push("operator must be an object.");
  } else {
    if (
      !isNonEmptyString(value.operator.pseudonym) ||
      value.operator.pseudonym.includes("@") ||
      value.operator.pseudonym.length > 80
    ) {
      errors.push("operator.pseudonym must be a non-email pseudonym of at most 80 characters.");
    }
    if (!isNonEmptyString(value.operator.role)) {
      errors.push("operator.role is required.");
    }
    if (value.operator.human !== true || value.operator.independent !== true) {
      errors.push("operator must attest human=true and independent=true.");
    }
  }

  if (!isObject(value.safety)) {
    errors.push("safety must be an object.");
  } else {
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
    );
  });

  for (const pairKey of expectedPairs.keys()) {
    if (!seenPairs.has(pairKey)) {
      errors.push(`Missing required observation ${pairKey}.`);
    }
  }

  const valid = errors.length === 0;
  return {
    valid,
    auditPassed: valid && gateFailures.length === 0,
    errors,
    gateFailures,
  };
}
