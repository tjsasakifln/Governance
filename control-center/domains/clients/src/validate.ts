import { z, type ZodIssue } from "zod";
import {
  ANY_SOURCE_PATTERN,
  BLOCKER_STATUSES,
  CLIENT_SLUG_PATTERN,
  COMMITMENT_STATUSES,
  CURRENCY_PATTERN,
  DELIVERABLE_STATUSES,
  EVIDENCE_REF_PATTERN,
  FACT_ID_PATTERN,
  FRESHNESS_STATUSES,
  INGEST_SOURCE_PATTERN,
  isReservedClientSlug,
  MIN_CLIENT_SLUG_LENGTH,
  OWNER_PATTERN,
  RISK_SEVERITIES,
  RISK_STATUSES,
  UTC_DATETIME_PATTERN,
  type Blocker,
  type Commitment,
  type Deliverable,
  type NextAction,
  type Provenance,
  type Risk,
} from "./contract.js";
import { ClientOpsError } from "./errors.js";
import { findSensitiveHits } from "./sensitive.js";

const utc = z.string().regex(new RegExp(UTC_DATETIME_PATTERN), "must be UTC RFC3339 ending in Z");
const slug = z
  .string()
  .regex(new RegExp(CLIENT_SLUG_PATTERN), "must be a kebab-case slug")
  .min(MIN_CLIENT_SLUG_LENGTH, "client_slug must be at least two characters")
  // Fail closed: a placeholder token is not an identity, and a record without an
  // identity is a data-quality exception, never a client in this store.
  .refine(
    (value) => !isReservedClientSlug(value),
    "client_slug must be a real client identity, not a placeholder such as 'unknown'",
  );
const factId = z.string().regex(new RegExp(FACT_ID_PATTERN), "must be a kebab-case id");
const owner = z.string().regex(new RegExp(OWNER_PATTERN), "must be a role-like owner id, not an email");
const evidence = z
  .string()
  .regex(new RegExp(EVIDENCE_REF_PATTERN), "must be an opaque evidence ref")
  .refine((value) => !/password=|token=|secret=/i.test(value), "evidence_ref must not carry secrets");
const ingestSource = z
  .string()
  .regex(new RegExp(INGEST_SOURCE_PATTERN), "source must be manual, governance, or adapter:<port>");
const anySource = z.string().regex(new RegExp(ANY_SOURCE_PATTERN));

const provenanceSchema = z
  .object({
    source: ingestSource,
    observed_at: utc,
    freshness_status: z.enum(FRESHNESS_STATUSES),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

const title = z.string().trim().min(1).max(200);

const commitmentSchema = z
  .object({
    id: factId,
    title,
    owner,
    due_at: utc,
    evidence_ref: evidence,
    status: z.enum(COMMITMENT_STATUSES),
    provenance: provenanceSchema,
  })
  .strict();

const blockerSchema = z
  .object({
    id: factId,
    title,
    owner: owner.nullable().optional(),
    evidence_ref: evidence.nullable().optional(),
    status: z.enum(BLOCKER_STATUSES),
    provenance: provenanceSchema,
  })
  .strict();

const deliverableSchema = z
  .object({
    id: factId,
    title,
    status: z.enum(DELIVERABLE_STATUSES),
    due_at: utc.nullable().optional(),
    evidence_ref: evidence.nullable().optional(),
    provenance: provenanceSchema,
  })
  .strict();

const riskSchema = z
  .object({
    id: factId,
    title,
    severity: z.enum(RISK_SEVERITIES),
    status: z.enum(RISK_STATUSES),
    evidence_ref: evidence.nullable().optional(),
    provenance: provenanceSchema,
  })
  .strict();

const nextActionSchema = z
  .object({
    summary: z.string().trim().min(1).max(300),
    due_at: utc.nullable().optional(),
    owner: owner.nullable().optional(),
    provenance: provenanceSchema,
  })
  .strict();

const moneySchema = z
  .object({
    amount_cents: z.number().int(),
    currency: z.string().regex(new RegExp(CURRENCY_PATTERN)),
  })
  .strict();

const ingestSchema = z
  .object({
    client_slug: slug,
    display_name: z
      .string()
      .trim()
      .min(MIN_CLIENT_SLUG_LENGTH)
      .max(120)
      .refine((value) => !value.includes("@"), "display_name must not look like an email")
      .refine(
        (value) => !isReservedClientSlug(value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "")),
        "display_name must name the client, not a placeholder such as 'Cliente'",
      ),
    source: ingestSource,
    observed_at: utc,
    freshness_status: z.enum(FRESHNESS_STATUSES),
    confidence: z.number().min(0).max(1).optional(),
    commitments: z.array(commitmentSchema).default([]),
    blockers: z.array(blockerSchema).default([]),
    deliverables: z.array(deliverableSchema).default([]),
    risk: z.array(riskSchema).default([]),
    next_action: nextActionSchema.nullable().optional(),
    // Accepted only so a later finance adapter can attach integer cents.
    // This domain does not persist receivables on the read model.
    value: moneySchema.optional(),
  })
  .strict();

export interface IngestDraft {
  client_slug: string;
  display_name: string;
  provenance: Provenance;
  commitments: Commitment[];
  blockers: Blocker[];
  deliverables: Deliverable[];
  risk: Risk[];
  next_action: NextAction | null;
}

export function parseIngestInput(raw: unknown): IngestDraft {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ClientOpsError("invalid_input", "ingest payload must be an object");
  }

  const sensitive = findSensitiveHits(raw);
  if (sensitive.length > 0) {
    const first = sensitive[0];
    throw new ClientOpsError(
      "sensitive_field",
      `refusing sensitive field at ${first?.path ?? "$"}`,
    );
  }

  const parsed = ingestSchema.safeParse(raw);
  if (!parsed.success) {
    throw mapZodError(parsed.error);
  }

  const data = parsed.data;
  assertUniqueIds(
    data.commitments.map((item) => item.id),
    "commitment",
  );
  assertUniqueIds(
    data.blockers.map((item) => item.id),
    "blocker",
  );
  assertUniqueIds(
    data.deliverables.map((item) => item.id),
    "deliverable",
  );
  assertUniqueIds(
    data.risk.map((item) => item.id),
    "risk",
  );

  const envelope: Provenance = {
    source: data.source,
    observed_at: data.observed_at,
    freshness_status: data.freshness_status,
    ...(data.confidence !== undefined ? { confidence: data.confidence } : {}),
  };

  return {
    client_slug: data.client_slug,
    display_name: data.display_name,
    provenance: envelope,
    commitments: data.commitments.map(normalizeCommitment),
    blockers: data.blockers.map(normalizeBlocker),
    deliverables: data.deliverables.map(normalizeDeliverable),
    risk: data.risk.map(normalizeRisk),
    next_action: data.next_action ? normalizeNextAction(data.next_action) : null,
  };
}

function normalizeCommitment(item: z.infer<typeof commitmentSchema>): Commitment {
  return {
    id: item.id,
    title: item.title,
    owner: item.owner,
    due_at: item.due_at,
    evidence_ref: item.evidence_ref,
    status: item.status,
    provenance: normalizeProvenance(item.provenance),
  };
}

function normalizeBlocker(item: z.infer<typeof blockerSchema>): Blocker {
  return {
    id: item.id,
    title: item.title,
    owner: item.owner ?? null,
    evidence_ref: item.evidence_ref ?? null,
    status: item.status,
    provenance: normalizeProvenance(item.provenance),
  };
}

function normalizeDeliverable(item: z.infer<typeof deliverableSchema>): Deliverable {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    due_at: item.due_at ?? null,
    evidence_ref: item.evidence_ref ?? null,
    provenance: normalizeProvenance(item.provenance),
  };
}

function normalizeRisk(item: z.infer<typeof riskSchema>): Risk {
  return {
    id: item.id,
    title: item.title,
    severity: item.severity,
    status: item.status,
    evidence_ref: item.evidence_ref ?? null,
    provenance: normalizeProvenance(item.provenance),
  };
}

function normalizeNextAction(item: z.infer<typeof nextActionSchema>): NextAction {
  return {
    summary: item.summary,
    due_at: item.due_at ?? null,
    owner: item.owner ?? null,
    provenance: normalizeProvenance(item.provenance),
  };
}

function normalizeProvenance(item: z.infer<typeof provenanceSchema>): Provenance {
  return {
    source: item.source,
    observed_at: item.observed_at,
    freshness_status: item.freshness_status,
    ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
  };
}

function assertUniqueIds(ids: string[], kind: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new ClientOpsError("invalid_input", `duplicate ${kind} id: ${id}`);
    }
    seen.add(id);
  }
}

function mapZodError(error: z.ZodError): ClientOpsError {
  const issue = error.issues[0];
  if (!issue) {
    return new ClientOpsError("invalid_input", "invalid ingest payload");
  }
  if (isMissingProvenance(issue)) {
    return new ClientOpsError(
      "missing_provenance",
      `missing provenance at ${formatPath(issue.path)}: ${issue.message}`,
    );
  }
  return new ClientOpsError(
    "invalid_input",
    `invalid input at ${formatPath(issue.path)}: ${issue.message}`,
  );
}

function isMissingProvenance(issue: ZodIssue): boolean {
  const path = issue.path.map(String);
  const last = path[path.length - 1];
  const provenanceFields = new Set(["source", "observed_at", "freshness_status", "provenance"]);
  if (last !== undefined && provenanceFields.has(last) && isAbsent(issue)) {
    return true;
  }
  if (path.includes("provenance") && isAbsent(issue)) {
    return true;
  }
  return false;
}

function isAbsent(issue: ZodIssue): boolean {
  return (
    issue.code === "invalid_type" &&
    "received" in issue &&
    (issue.received === "undefined" || issue.received === "null")
  );
}

function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) {
    return "$";
  }
  return path.map(String).join(".");
}

/** Runtime guard used by query inputs. */
export function assertQueryHorizonHours(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 24 * 90) {
    throw new ClientOpsError("invalid_input", "horizonHours must be an integer between 0 and 2160");
  }
}

export function assertAnySource(source: string): void {
  const result = anySource.safeParse(source);
  if (!result.success) {
    throw new ClientOpsError("invalid_input", `invalid source: ${source}`);
  }
}
