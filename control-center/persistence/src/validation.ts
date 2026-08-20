import { z } from 'zod';
import { ValidationError } from './errors.js';
import {
  ATTENTION_SEVERITIES,
  ATTENTION_STATUSES,
  DIRECTIVE_KINDS,
  DIRECTIVE_STATUSES,
  FRESHNESS_STATUSES,
} from './types.js';

const isoCurrency = z.string().regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO code');

export const moneySchema = z.object({
  amountCents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: isoCurrency,
});

export const scopeSchema = z.string().trim().min(1).max(256);
export const sourceSchema = z.string().trim().min(1).max(256);
export const freshnessSchema = z.enum(FRESHNESS_STATUSES);
export const confidenceSchema = z.number().min(0).max(1).nullable();

export const provenanceSchema = z.object({
  source: sourceSchema,
  observedAt: z.date(),
  freshnessStatus: freshnessSchema,
  confidence: confidenceSchema.optional().default(null),
});

export const createDirectiveInputSchema = provenanceSchema.extend({
  kind: z.enum(DIRECTIVE_KINDS),
  scope: scopeSchema,
  status: z.enum(DIRECTIVE_STATUSES).optional().default('active'),
  title: z.string().trim().min(1).max(512),
  body: z.string().min(1).max(20000),
  effectiveFrom: z.date(),
  expiresAt: z.date().nullable().optional().default(null),
  createdBy: z.string().trim().min(1).max(256),
  recordedBy: z.string().trim().min(1).max(256).optional(),
  supersedes: z.string().uuid().nullable().optional().default(null),
});

export const supersedeDirectiveInputSchema = provenanceSchema.extend({
  existingId: z.string().uuid(),
  kind: z.enum(DIRECTIVE_KINDS),
  scope: scopeSchema,
  title: z.string().trim().min(1).max(512),
  body: z.string().min(1).max(20000),
  effectiveFrom: z.date(),
  expiresAt: z.date().nullable().optional().default(null),
  createdBy: z.string().trim().min(1).max(256),
  recordedBy: z.string().trim().min(1).max(256).optional(),
});

export const recordObservationInputSchema = provenanceSchema.extend({
  scope: scopeSchema,
  observationKind: z.string().trim().min(1).max(128),
  payload: z.record(z.unknown()).optional().default({}),
  money: moneySchema.nullable().optional().default(null),
  idempotencyKey: z.string().trim().min(1).max(512),
  collectorRunId: z.string().uuid().nullable().optional().default(null),
});

export const startCollectorRunInputSchema = provenanceSchema.extend({
  collectorName: z.string().trim().min(1).max(128),
  idempotencyKey: z.string().trim().min(1).max(512),
  scope: scopeSchema,
});

export const finishCollectorRunInputSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['succeeded', 'failed', 'skipped'] as const),
  errorCode: z.string().trim().min(1).max(64).nullable().optional().default(null),
  stats: z.record(z.unknown()).optional().default({}),
  observedAt: z.date(),
  freshnessStatus: freshnessSchema,
  confidence: confidenceSchema.optional().default(null),
});

export const recordSnapshotInputSchema = provenanceSchema.extend({
  scope: scopeSchema,
  snapshotKind: z.string().trim().min(1).max(128),
  payload: z.record(z.unknown()),
  money: moneySchema.nullable().optional().default(null),
});

export const createAttentionItemInputSchema = provenanceSchema.extend({
  scope: scopeSchema,
  severity: z.enum(ATTENTION_SEVERITIES),
  title: z.string().trim().min(1).max(512),
  body: z.string().min(1).max(20000),
  status: z.enum(ATTENTION_STATUSES).optional().default('open'),
  relatedDirectiveId: z.string().uuid().nullable().optional().default(null),
  money: moneySchema.nullable().optional().default(null),
  expiresAt: z.date().nullable().optional().default(null),
});

export const startAgentSessionInputSchema = provenanceSchema.extend({
  scope: scopeSchema,
  agentId: z.string().trim().min(1).max(256),
  contextQuery: z.record(z.unknown()).optional().default({}),
});

export const appendAuditEventInputSchema = provenanceSchema.extend({
  actor: z.string().trim().min(1).max(256),
  action: z.string().trim().min(1).max(128),
  entityType: z.string().trim().min(1).max(64),
  entityId: z.string().uuid().nullable().optional().default(null),
  scope: scopeSchema,
  payload: z.record(z.unknown()).optional().default({}),
});

export const scopeQuerySchema = z.object({
  scope: scopeSchema,
});

export const scopedIdQuerySchema = z.object({
  scope: scopeSchema,
  id: z.string().uuid(),
});

export function parseInput<S extends z.ZodTypeAny>(schema: S, value: unknown, label: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(`${label}: ${result.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  return result.data;
}
