import { z, type ZodIssue } from "zod";
import {
  ACTOR_ID_PATTERN,
  ACTOR_KINDS,
  CORRELATION_ID_PATTERN,
  EXECUTION_STATUSES,
  FRESHNESS_STATUSES,
  SOURCE_KIND_PATTERN,
  SOURCE_SYSTEM_PATTERN,
  UTC_DATE_PATTERN,
  UTC_DATETIME_PATTERN,
  type ActorRef,
  type ContextConsulted,
  type ExecutionStatus,
  type FounderApproval,
  type Provenance,
  type SourceRef,
  type VcsRefs,
} from "./contract.js";
import { LedgerError } from "./errors.js";
import { findSensitiveHits } from "./sensitive.js";

const utc = z
  .string()
  .regex(new RegExp(UTC_DATETIME_PATTERN), "must be UTC RFC3339 ending in Z");
const utcDate = z.string().regex(new RegExp(UTC_DATE_PATTERN), "must be YYYY-MM-DD UTC");
const correlationId = z
  .string()
  .regex(new RegExp(CORRELATION_ID_PATTERN), "must be an opaque correlation/session id");
const actorId = z
  .string()
  .regex(new RegExp(ACTOR_ID_PATTERN), "must be an opaque actor handle, not an email");
const nonEmpty = z.string().trim().min(1).max(512);
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().max(4000);
const stringList = z.array(z.string().trim().min(1).max(512)).max(64);

const sourceRefSchema = z
  .object({
    system: z.string().regex(new RegExp(SOURCE_SYSTEM_PATTERN), "source.system must be lowercase kebab"),
    kind: z.string().regex(new RegExp(SOURCE_KIND_PATTERN), "source.kind must be lowercase kebab"),
    locator: z.string().trim().min(1).max(512),
    label: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

const provenanceFields = {
  source: sourceRefSchema,
  observed_at: utc,
  freshness_status: z.enum(FRESHNESS_STATUSES),
  confidence: z.number().min(0).max(1).optional(),
};

const actorSchema = z
  .object({
    kind: z.enum(ACTOR_KINDS),
    id: actorId,
    display_name: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

const founderApprovalSchema = z
  .object({
    approved: z.literal(true),
    by: actorId,
    at: utc,
  })
  .strict();

const refsSchema = z
  .object({
    branch: z.string().trim().min(1).max(256).nullable().optional(),
    commit: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/i, "commit must be a git SHA")
      .nullable()
      .optional(),
    pr: z.string().trim().min(1).max(128).nullable().optional(),
    issues: z.array(z.string().trim().min(1).max(128)).max(32).optional(),
  })
  .strict();

const contextSchema = z
  .object({
    context_version: z.string().trim().min(1).max(128).nullable().optional(),
    directive_ids: z.array(z.string().trim().min(1).max(128)).max(64).optional(),
  })
  .strict();

const agentSchema = z
  .object({
    id: actorId,
    provider: shortText,
  })
  .strict();

const startSchema = z
  .object({
    correlation_id: correlationId,
    agent: agentSchema,
    repo: shortText,
    goal: nonEmpty,
    campaign: z.string().trim().min(1).max(200).nullable().optional(),
    started_at: utc.optional(),
    refs: refsSchema.optional(),
    summary: longText.optional(),
    evidence: stringList.optional(),
    blockers: stringList.optional(),
    residual_work: stringList.optional(),
    context_consulted: contextSchema.optional(),
    actor: actorSchema,
    founder_approval: founderApprovalSchema.nullable().optional(),
    ...provenanceFields,
  })
  .strict();

const reportSchema = z
  .object({
    correlation_id: correlationId,
    status: z.enum(EXECUTION_STATUSES),
    agent: agentSchema.optional(),
    repo: shortText.optional(),
    goal: nonEmpty.optional(),
    campaign: z.string().trim().min(1).max(200).nullable().optional(),
    started_at: utc.optional(),
    finished_at: utc.nullable().optional(),
    refs: refsSchema.optional(),
    summary: longText,
    evidence: stringList.optional(),
    blockers: stringList.optional(),
    residual_work: stringList.optional(),
    context_consulted: contextSchema.optional(),
    actor: actorSchema,
    founder_approval: founderApprovalSchema.nullable().optional(),
    ...provenanceFields,
  })
  .strict();

const heartbeatSchema = z
  .object({
    correlation_id: correlationId,
    actor: actorSchema,
    ...provenanceFields,
  })
  .strict();

const timelineSchema = z
  .object({
    date: utcDate.optional(),
    from: utc.optional(),
    to: utc.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.date) || (Boolean(value.from) && Boolean(value.to)), {
    message: "timeline requires date (YYYY-MM-DD UTC) or from+to UTC window",
  });

const lastActivitySchema = z
  .object({
    as_of: utc.optional(),
    date: utcDate.optional(),
    from: utc.optional(),
    to: utc.optional(),
  })
  .strict();

export interface ParsedStart {
  correlation_id: string;
  agent: { id: string; provider: string };
  repo: string;
  goal: string;
  campaign: string | null;
  started_at: string | undefined;
  refs: VcsRefs;
  summary: string;
  evidence: string[];
  blockers: string[];
  residual_work: string[];
  context_consulted: ContextConsulted;
  actor: ActorRef;
  founder_approval: FounderApproval | null;
  provenance: Provenance;
}

export interface ParsedReport {
  correlation_id: string;
  status: ExecutionStatus;
  agent: { id: string; provider: string } | undefined;
  repo: string | undefined;
  goal: string | undefined;
  campaign: string | null | undefined;
  started_at: string | undefined;
  finished_at: string | null | undefined;
  refs: Partial<VcsRefs> | undefined;
  summary: string;
  evidence: string[] | undefined;
  blockers: string[] | undefined;
  residual_work: string[] | undefined;
  context_consulted: Partial<ContextConsulted> | undefined;
  actor: ActorRef;
  founder_approval: FounderApproval | null;
  provenance: Provenance;
}

export interface ParsedHeartbeat {
  correlation_id: string;
  actor: ActorRef;
  provenance: Provenance;
}

export interface ParsedTimelineQuery {
  from: string;
  to: string;
}

export interface ParsedLastActivityQuery {
  as_of: string | undefined;
  from: string | undefined;
  to: string | undefined;
}

export function parseStartInput(raw: unknown): ParsedStart {
  const value = parseWith(startSchema, raw);
  return {
    correlation_id: value.correlation_id,
    agent: value.agent,
    repo: value.repo,
    goal: value.goal,
    campaign: value.campaign ?? null,
    started_at: value.started_at,
    refs: normalizeRefs(value.refs),
    summary: value.summary ?? "",
    evidence: value.evidence ?? [],
    blockers: value.blockers ?? [],
    residual_work: value.residual_work ?? [],
    context_consulted: normalizeContext(value.context_consulted),
    actor: value.actor,
    founder_approval: value.founder_approval ?? null,
    provenance: toProvenance(value),
  };
}

export function parseReportInput(raw: unknown): ParsedReport {
  const value = parseWith(reportSchema, raw);
  return {
    correlation_id: value.correlation_id,
    status: value.status,
    agent: value.agent,
    repo: value.repo,
    goal: value.goal,
    campaign: value.campaign,
    started_at: value.started_at,
    finished_at: value.finished_at,
    refs: value.refs,
    summary: value.summary,
    evidence: value.evidence,
    blockers: value.blockers,
    residual_work: value.residual_work,
    context_consulted: value.context_consulted,
    actor: value.actor,
    founder_approval: value.founder_approval ?? null,
    provenance: toProvenance(value),
  };
}

export function parseHeartbeatInput(raw: unknown): ParsedHeartbeat {
  const value = parseWith(heartbeatSchema, raw);
  return {
    correlation_id: value.correlation_id,
    actor: value.actor,
    provenance: toProvenance(value),
  };
}

export function parseTimelineQuery(raw: unknown): ParsedTimelineQuery {
  const value = parseWith(timelineSchema, raw ?? {});
  if (value.date) {
    const from = `${value.date}T00:00:00.000Z`;
    const startMs = Date.parse(from);
    const to = new Date(startMs + 24 * 60 * 60 * 1000).toISOString();
    return { from, to };
  }
  if (!value.from || !value.to) {
    throw new LedgerError("invalid_input", "timeline requires date or from+to");
  }
  if (Date.parse(value.from) >= Date.parse(value.to)) {
    throw new LedgerError("invalid_input", "timeline from must be earlier than to");
  }
  return { from: value.from, to: value.to };
}

export function parseLastActivityQuery(raw: unknown): ParsedLastActivityQuery {
  const value = parseWith(lastActivitySchema, raw ?? {});
  if (value.date) {
    const from = `${value.date}T00:00:00.000Z`;
    const startMs = Date.parse(from);
    const to = new Date(startMs + 24 * 60 * 60 * 1000).toISOString();
    return { as_of: value.as_of, from, to };
  }
  return { as_of: value.as_of, from: value.from, to: value.to };
}

function toProvenance(value: {
  source: SourceRef;
  observed_at: string;
  freshness_status: Provenance["freshness_status"];
  confidence?: number;
}): Provenance {
  const provenance: Provenance = {
    source: value.source,
    observed_at: value.observed_at,
    freshness_status: value.freshness_status,
  };
  if (value.confidence !== undefined) {
    provenance.confidence = value.confidence;
  }
  return provenance;
}

function normalizeRefs(refs: z.infer<typeof refsSchema> | undefined): VcsRefs {
  return {
    branch: refs?.branch ?? null,
    commit: refs?.commit ?? null,
    pr: refs?.pr ?? null,
    issues: refs?.issues ?? [],
  };
}

function normalizeContext(
  context: z.infer<typeof contextSchema> | undefined,
): ContextConsulted {
  return {
    context_version: context?.context_version ?? null,
    directive_ids: context?.directive_ids ?? [],
  };
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): T {
  assertNoSensitive(raw);
  const result = schema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  throw zodToLedgerError(result.error.issues);
}

function zodToLedgerError(issues: ZodIssue[]): LedgerError {
  const first = issues[0];
  const path = first?.path.join(".") ?? "";
  const message = first?.message ?? "invalid input";
  const provenanceMissing =
    path === "source" ||
    path === "observed_at" ||
    path === "freshness_status" ||
    first?.code === "invalid_type" &&
      (path === "source" || path === "observed_at" || path === "freshness_status");
  if (
    provenanceMissing ||
    message.includes("Required") &&
      (path === "source" || path === "observed_at" || path === "freshness_status")
  ) {
    return new LedgerError(
      "missing_provenance",
      `aggregated records require source, observed_at, and freshness_status (${path || "provenance"})`,
    );
  }
  return new LedgerError("invalid_input", path ? `${path}: ${message}` : message);
}

function assertNoSensitive(raw: unknown): void {
  const hits = findSensitiveHits(raw);
  if (hits.length > 0) {
    const first = hits[0];
    throw new LedgerError(
      "sensitive_field",
      `refusing payload with sensitive field at ${first?.path ?? "$"}`,
    );
  }
}

export function isProvenanceAbsent(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") {
    return true;
  }
  const record = raw as Record<string, unknown>;
  return (
    record.source === undefined ||
    record.observed_at === undefined ||
    record.freshness_status === undefined
  );
}
