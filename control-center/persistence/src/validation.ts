import { z } from 'zod';
import {
  isConfidence,
  isFreshnessStatus,
  isResourceId,
  isScope,
  isSourceRef,
  isUuid,
  RESOURCE_ID_PATTERN,
  SOURCE_KIND_PATTERN,
  SOURCE_SYSTEM_PATTERN,
} from './canonical.js';
import { ValidationError } from './errors.js';
import {
  AGENT_ACTIVITY_STATUSES,
  ATTENTION_SEVERITIES,
  ATTENTION_STATUSES,
  DIRECTIVE_KINDS,
  DIRECTIVE_STATUSES,
  FRESHNESS_STATUSES,
} from './types.js';
import { COLLECTOR_RUN_STATUSES, LEGACY_COLLECTOR_RUN_STATUSES } from './run-status.js';
import { assertSanitizedJson } from './sanitize.js';

const isoCurrency = z.string().regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO code');

export const moneySchema = z.object({
  amountCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: isoCurrency,
});

export const scopeSchema = z.string().superRefine((value, ctx) => {
  if (!isScope(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'scope is not the canonical Control Center grammar' });
  }
});

export const resourceIdSchema = z.string().superRefine((value, ctx) => {
  if (isUuid(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'UUID is not a public identity' });
    return;
  }
  if (!isResourceId(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `must match ${RESOURCE_ID_PATTERN}` });
  }
});

export const nullableResourceIdSchema = z.union([resourceIdSchema, z.null()]).optional().default(null);

export const sourceRefSchema = z
  .object({
    system: z.string().regex(new RegExp(SOURCE_SYSTEM_PATTERN)).min(1).max(64),
    kind: z.string().regex(new RegExp(SOURCE_KIND_PATTERN)).min(1).max(64),
    locator: z.string().min(1).max(512),
    label: z.string().min(1).max(128).optional(),
  })
  .strict();

export const freshnessSchema = z.enum(FRESHNESS_STATUSES);
export const confidenceSchema = z.number().min(0).max(1);

export const provenanceSchema = z.object({
  source: sourceRefSchema,
  observedAt: z.date(),
  freshnessStatus: freshnessSchema,
  confidence: confidenceSchema,
});

export const createDirectiveInputSchema = provenanceSchema.extend({
  id: resourceIdSchema.optional(),
  revisionId: resourceIdSchema.optional(),
  kind: z.enum(DIRECTIVE_KINDS),
  scope: scopeSchema,
  status: z.enum(DIRECTIVE_STATUSES).optional().default('active'),
  title: z.string().trim().min(1).max(512),
  body: z.string().min(1).max(20000),
  effectiveFrom: z.date(),
  expiresAt: z.date().nullable().optional().default(null),
  createdBy: z.string().trim().min(1).max(256),
  recordedBy: z.string().trim().min(1).max(256).optional(),
  supersedes: z.array(resourceIdSchema).optional().default([]),
});

export const supersedeDirectiveInputSchema = provenanceSchema.extend({
  existingId: resourceIdSchema,
  kind: z.enum(DIRECTIVE_KINDS),
  scope: scopeSchema,
  title: z.string().trim().min(1).max(512),
  body: z.string().min(1).max(20000),
  effectiveFrom: z.date(),
  expiresAt: z.date().nullable().optional().default(null),
  createdBy: z.string().trim().min(1).max(256),
  recordedBy: z.string().trim().min(1).max(256).optional(),
});

const sanitizedObjectSchema = z.record(z.unknown()).superRefine((value, ctx) => {
  try {
    assertSanitizedJson(value, 'payload');
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'payload is invalid',
    });
  }
});

export const recordObservationInputSchema = provenanceSchema.extend({
  scope: scopeSchema,
  observationKind: z.string().trim().min(1).max(128),
  payload: sanitizedObjectSchema.optional().default({}),
  money: moneySchema.nullable().optional().default(null),
  idempotencyKey: z.string().trim().min(1).max(512),
  collectorRunId: nullableResourceIdSchema,
});

export const startCollectorRunInputSchema = provenanceSchema.extend({
  collectorName: z.string().trim().min(1).max(128),
  idempotencyKey: z.string().trim().min(1).max(512),
  scope: scopeSchema,
});

export const finishCollectorRunInputSchema = z.object({
  id: resourceIdSchema,
  status: z.enum([...COLLECTOR_RUN_STATUSES, ...LEGACY_COLLECTOR_RUN_STATUSES]),
  errorCode: z.string().trim().min(1).max(64).nullable().optional().default(null),
  errorMessage: z.string().trim().min(1).max(512).nullable().optional().default(null),
  stats: sanitizedObjectSchema.optional().default({}),
  payload: sanitizedObjectSchema.optional().default({}),
  payloadRef: z.string().trim().min(1).max(512).nullable().optional().default(null),
  observedAt: z.date(),
  freshnessStatus: freshnessSchema,
  confidence: confidenceSchema,
});

export const recordSnapshotInputSchema = provenanceSchema.extend({
  scope: scopeSchema,
  snapshotKind: z.string().trim().min(1).max(128),
  payload: sanitizedObjectSchema,
  money: moneySchema.nullable().optional().default(null),
  idempotencyKey: z.string().trim().min(1).max(512).optional(),
});

export const reviseSnapshotInputSchema = z.object({
  id: resourceIdSchema,
  payload: sanitizedObjectSchema,
  observedAt: z.date(),
  freshnessStatus: freshnessSchema,
  confidence: confidenceSchema,
  source: sourceRefSchema,
});

export const createAttentionItemInputSchema = provenanceSchema.extend({
  scope: scopeSchema,
  severity: z.enum(ATTENTION_SEVERITIES),
  title: z.string().trim().min(1).max(512),
  body: z.string().min(1).max(20000),
  status: z.enum(ATTENTION_STATUSES).optional().default('open'),
  relatedDirectiveId: nullableResourceIdSchema,
  money: moneySchema.nullable().optional().default(null),
  expiresAt: z.date().nullable().optional().default(null),
});

export const startAgentSessionInputSchema = provenanceSchema.extend({
  scope: scopeSchema,
  agentId: z.string().trim().min(1).max(256),
  contextQuery: z.record(z.unknown()).optional().default({}),
});

export const recordAgentActivityInputSchema = provenanceSchema.extend({
  correlationId: z.string().trim().min(1).max(128),
  agentId: z.string().trim().min(1).max(256),
  scope: scopeSchema,
  status: z.enum(AGENT_ACTIVITY_STATUSES).optional().default('RUNNING'),
  goal: z.string().trim().min(1).max(512),
  summary: z.string().min(1).max(20000),
  startedAt: z.date().optional(),
  finishedAt: z.date().nullable().optional().default(null),
  payload: z.record(z.unknown()).optional().default({}),
});

export const appendAuditEventInputSchema = provenanceSchema.extend({
  actor: z.string().trim().min(1).max(256),
  action: z.string().trim().min(1).max(128),
  entityType: z.string().trim().min(1).max(64),
  entityId: nullableResourceIdSchema,
  scope: scopeSchema,
  payload: z.record(z.unknown()).optional().default({}),
});

export const scopeQuerySchema = z.object({
  scope: scopeSchema,
});

export const scopedIdQuerySchema = z.object({
  scope: scopeSchema,
  id: resourceIdSchema,
});

export const publicIdQuerySchema = z.object({
  id: resourceIdSchema,
});

export function parseInput<S extends z.ZodTypeAny>(schema: S, value: unknown, label: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`${label}: ${result.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  return result.data;
}

export function assertCanonicalWrite(value: {
  freshnessStatus?: unknown;
  status?: unknown;
  scope?: unknown;
  source?: unknown;
  confidence?: unknown;
  id?: unknown;
}): void {
  if (value.freshnessStatus !== undefined && !isFreshnessStatus(value.freshnessStatus)) {
    throw new ValidationError('freshnessStatus must be FRESH|STALE|UNKNOWN|ERROR');
  }
  if (value.scope !== undefined && !isScope(value.scope)) {
    throw new ValidationError('scope is not the canonical Control Center grammar');
  }
  if (value.source !== undefined && !isSourceRef(value.source)) {
    throw new ValidationError('source must be a structured SourceRef');
  }
  if (value.confidence !== undefined && !isConfidence(value.confidence)) {
    throw new ValidationError('confidence must be in [0,1]');
  }
  if (value.id !== undefined && isUuid(value.id)) {
    throw new ValidationError('UUID is not a public identity');
  }
}
