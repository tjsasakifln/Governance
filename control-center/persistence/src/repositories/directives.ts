import type { PoolClient } from 'pg';
import { NotFoundError, ValidationError } from '../errors.js';
import { generatePublicId } from '../ids.js';
import { logEvent } from '../log.js';
import { sourceColumns, toUtcIso } from '../money.js';
import {
  mapCurrentDirective,
  mapDirective,
  mapRevision,
  type CurrentDirectiveRow,
  type DirectiveRevisionRow,
  type DirectiveRow,
} from '../rows.js';
import type {
  CreateDirectiveInput,
  CurrentDirective,
  Directive,
  DirectiveRevision,
  SourceRef,
  SupersedeDirectiveInput,
} from '../types.js';
import {
  parseInput,
  createDirectiveInputSchema,
  publicIdQuerySchema,
  scopedIdQuerySchema,
  scopeQuerySchema,
  supersedeDirectiveInputSchema,
} from '../validation.js';
import { insertAuditEvent } from './audit.js';

const DIRECTIVE_SUPERSEDES_SQL = `(
  SELECT COALESCE(array_agg(s.superseded_id ORDER BY s.superseded_id), ARRAY[]::text[])
  FROM control_center.directive_supersedes s
  WHERE s.directive_id = control_center.directives.id
) AS supersedes`;

const REVISION_SUPERSEDES_SQL = `(
  SELECT COALESCE(array_agg(s.superseded_id ORDER BY s.superseded_id), ARRAY[]::text[])
  FROM control_center.directive_revision_supersedes s
  WHERE s.revision_id = control_center.directive_revisions.id
) AS supersedes`;

const CURRENT_SUPERSEDES_SQL = `(
  SELECT COALESCE(array_agg(s.superseded_id ORDER BY s.superseded_id), ARRAY[]::text[])
  FROM control_center.directive_supersedes s
  WHERE s.directive_id = control_center.current_directives.directive_id
) AS supersedes`;

const DIRECTIVE_COLUMNS = `
  id, kind, scope, status, title, body, effective_from, expires_at,
  created_by, created_at, current_revision_id, ${DIRECTIVE_SUPERSEDES_SQL}
`;

const REVISION_COLUMNS = `
  id, directive_id, revision_no, kind, scope, status, title, body, effective_from,
  expires_at, created_by, source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, recorded_at, recorded_by,
  ${REVISION_SUPERSEDES_SQL}
`;

const CURRENT_COLUMNS = `
  directive_id, revision_id, kind, scope, status, title, effective_from, expires_at,
  created_by, source_system, source_kind, source_locator, source_label,
  observed_at, freshness_status, confidence, updated_at,
  ${CURRENT_SUPERSEDES_SQL}
`;

async function insertSupersedes(
  tx: PoolClient,
  table: 'directive_supersedes' | 'directive_revision_supersedes',
  ownerColumn: 'directive_id' | 'revision_id',
  ownerId: string,
  supersededIds: string[],
): Promise<void> {
  for (const supersededId of supersededIds) {
    await tx.query(
      `INSERT INTO control_center.${table} (${ownerColumn}, superseded_id) VALUES ($1, $2)`,
      [ownerId, supersededId],
    );
  }
}

async function insertRevision(
  tx: PoolClient,
  params: {
    id: string;
    directiveId: string;
    revisionNo: number;
    kind: string;
    scope: string;
    status: string;
    title: string;
    body: string;
    effectiveFrom: Date;
    expiresAt: Date | null;
    supersedes: string[];
    createdBy: string;
    source: SourceRef;
    observedAt: Date;
    freshnessStatus: string;
    confidence: number;
    recordedBy: string;
  },
): Promise<DirectiveRevision> {
  const source = sourceColumns(params.source);
  await tx.query(
    `INSERT INTO control_center.directive_revisions (
       id, directive_id, revision_no, kind, scope, status, title, body, effective_from,
       expires_at, created_by, source_system, source_kind, source_locator, source_label,
       observed_at, freshness_status, confidence, recorded_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
     )`,
    [
      params.id,
      params.directiveId,
      params.revisionNo,
      params.kind,
      params.scope,
      params.status,
      params.title,
      params.body,
      toUtcIso(params.effectiveFrom),
      params.expiresAt ? toUtcIso(params.expiresAt) : null,
      params.createdBy,
      source.system,
      source.kind,
      source.locator,
      source.label,
      toUtcIso(params.observedAt),
      params.freshnessStatus,
      params.confidence,
      params.recordedBy,
    ],
  );
  await insertSupersedes(
    tx,
    'directive_revision_supersedes',
    'revision_id',
    params.id,
    params.supersedes,
  );
  const loaded = await tx.query(
    `SELECT ${REVISION_COLUMNS} FROM control_center.directive_revisions WHERE id = $1`,
    [params.id],
  );
  return mapRevision(loaded.rows[0] as DirectiveRevisionRow);
}

async function upsertCurrent(tx: PoolClient, revision: DirectiveRevision): Promise<void> {
  const source = sourceColumns(revision.source);
  await tx.query(
    `INSERT INTO control_center.current_directives (
       directive_id, revision_id, kind, scope, status, title, effective_from, expires_at,
       created_by, source_system, source_kind, source_locator, source_label,
       observed_at, freshness_status, confidence, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now()
     )
     ON CONFLICT (directive_id) DO UPDATE SET
       revision_id = EXCLUDED.revision_id,
       kind = EXCLUDED.kind,
       scope = EXCLUDED.scope,
       status = EXCLUDED.status,
       title = EXCLUDED.title,
       effective_from = EXCLUDED.effective_from,
       expires_at = EXCLUDED.expires_at,
       created_by = EXCLUDED.created_by,
       source_system = EXCLUDED.source_system,
       source_kind = EXCLUDED.source_kind,
       source_locator = EXCLUDED.source_locator,
       source_label = EXCLUDED.source_label,
       observed_at = EXCLUDED.observed_at,
       freshness_status = EXCLUDED.freshness_status,
       confidence = EXCLUDED.confidence,
       updated_at = now()`,
    [
      revision.directiveId,
      revision.id,
      revision.kind,
      revision.scope,
      revision.status,
      revision.title,
      toUtcIso(revision.effectiveFrom),
      revision.expiresAt ? toUtcIso(revision.expiresAt) : null,
      revision.createdBy,
      source.system,
      source.kind,
      source.locator,
      source.label,
      toUtcIso(revision.observedAt),
      revision.freshnessStatus,
      revision.confidence,
    ],
  );
}

export async function createDirective(tx: PoolClient, raw: CreateDirectiveInput): Promise<{
  directive: Directive;
  revision: DirectiveRevision;
}> {
  const input = parseInput(createDirectiveInputSchema, raw, 'createDirective');
  if (input.expiresAt && input.expiresAt <= input.effectiveFrom) {
    throw new ValidationError('expiresAt must be after effectiveFrom');
  }
  const directiveId = input.id ?? generatePublicId('directive');
  const revisionId = input.revisionId ?? generatePublicId('directive-revision');
  const recordedBy = input.recordedBy ?? input.createdBy;
  const status = input.status;
  const supersedes = input.supersedes ?? [];

  await tx.query(
    `INSERT INTO control_center.directives (
       id, kind, scope, status, title, body, effective_from, expires_at,
       created_by, current_revision_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      directiveId,
      input.kind,
      input.scope,
      status,
      input.title,
      input.body,
      toUtcIso(input.effectiveFrom),
      input.expiresAt ? toUtcIso(input.expiresAt) : null,
      input.createdBy,
      revisionId,
    ],
  );

  const revision = await insertRevision(tx, {
    id: revisionId,
    directiveId,
    revisionNo: 1,
    kind: input.kind,
    scope: input.scope,
    status,
    title: input.title,
    body: input.body,
    effectiveFrom: input.effectiveFrom,
    expiresAt: input.expiresAt ?? null,
    supersedes,
    createdBy: input.createdBy,
    source: input.source,
    observedAt: input.observedAt,
    freshnessStatus: input.freshnessStatus,
    confidence: input.confidence,
    recordedBy,
  });
  await insertSupersedes(tx, 'directive_supersedes', 'directive_id', directiveId, supersedes);

  const directiveResult = await tx.query(
    `SELECT ${DIRECTIVE_COLUMNS} FROM control_center.directives WHERE id = $1`,
    [directiveId],
  );
  const directive = mapDirective(directiveResult.rows[0] as DirectiveRow);
  await upsertCurrent(tx, revision);
  await insertAuditEvent(tx, {
    actor: recordedBy,
    action: 'directive.create',
    entityType: 'directive',
    entityId: directiveId,
    scope: input.scope,
    payload: { kind: input.kind, revisionId },
    source: input.source,
    observedAt: input.observedAt,
    freshnessStatus: input.freshnessStatus,
    confidence: input.confidence,
  });
  logEvent('directive.create', { directiveId, kind: input.kind, scope: input.scope });
  return { directive, revision };
}

export async function supersedeDirective(tx: PoolClient, raw: SupersedeDirectiveInput): Promise<{
  replacement: Directive;
  replacementRevision: DirectiveRevision;
  superseded: Directive;
  originalRevision: DirectiveRevision;
  supersededRevision: DirectiveRevision;
}> {
  const input = parseInput(supersedeDirectiveInputSchema, raw, 'supersedeDirective');
  const originalDirectiveResult = await tx.query(
    `SELECT ${DIRECTIVE_COLUMNS} FROM control_center.directives WHERE id = $1`,
    [input.existingId],
  );
  if (originalDirectiveResult.rowCount !== 1) {
    throw new NotFoundError(`directive ${input.existingId} not found`);
  }
  const originalDirective = mapDirective(originalDirectiveResult.rows[0] as DirectiveRow);
  const originalRevisionResult = await tx.query(
    `SELECT ${REVISION_COLUMNS}
     FROM control_center.directive_revisions
     WHERE id = $1`,
    [originalDirective.currentRevisionId],
  );
  const originalRevision = mapRevision(originalRevisionResult.rows[0] as DirectiveRevisionRow);

  const created = await createDirective(tx, {
    kind: input.kind,
    scope: input.scope,
    status: 'active',
    title: input.title,
    body: input.body,
    effectiveFrom: input.effectiveFrom,
    expiresAt: input.expiresAt ?? null,
    createdBy: input.createdBy,
    recordedBy: input.recordedBy ?? input.createdBy,
    supersedes: [input.existingId],
    source: input.source,
    observedAt: input.observedAt,
    freshnessStatus: input.freshnessStatus,
    confidence: input.confidence,
  });

  const nextRevisionNo = originalRevision.revisionNo + 1;
  const supersededRevision = await insertRevision(tx, {
    id: generatePublicId('directive-revision'),
    directiveId: originalDirective.id,
    revisionNo: nextRevisionNo,
    kind: originalDirective.kind,
    scope: originalDirective.scope,
    status: 'superseded',
    title: originalDirective.title,
    body: originalDirective.body,
    effectiveFrom: originalDirective.effectiveFrom,
    expiresAt: originalDirective.expiresAt,
    supersedes: originalDirective.supersedes,
    createdBy: originalDirective.createdBy,
    source: input.source,
    observedAt: input.observedAt,
    freshnessStatus: input.freshnessStatus,
    confidence: input.confidence,
    recordedBy: input.recordedBy ?? input.createdBy,
  });

  await tx.query(
    `UPDATE control_center.directives
     SET status = 'superseded', current_revision_id = $2
     WHERE id = $1`,
    [originalDirective.id, supersededRevision.id],
  );
  await upsertCurrent(tx, supersededRevision);

  const replacementResult = await tx.query(
    `SELECT ${DIRECTIVE_COLUMNS} FROM control_center.directives WHERE id = $1`,
    [created.directive.id],
  );
  const replacement = mapDirective(replacementResult.rows[0] as DirectiveRow);
  const supersededResult = await tx.query(
    `SELECT ${DIRECTIVE_COLUMNS} FROM control_center.directives WHERE id = $1`,
    [originalDirective.id],
  );
  const superseded = mapDirective(supersededResult.rows[0] as DirectiveRow);

  await insertAuditEvent(tx, {
    actor: input.recordedBy ?? input.createdBy,
    action: 'directive.supersede',
    entityType: 'directive',
    entityId: replacement.id,
    scope: input.scope,
    payload: { supersedes: [originalDirective.id], originalRevisionId: originalRevision.id },
    source: input.source,
    observedAt: input.observedAt,
    freshnessStatus: input.freshnessStatus,
    confidence: input.confidence,
  });
  logEvent('directive.supersede', {
    directiveId: replacement.id,
    supersedes: originalDirective.id,
    scope: input.scope,
  });

  return {
    replacement,
    replacementRevision: created.revision,
    superseded,
    originalRevision,
    supersededRevision,
  };
}

export async function getDirective(tx: PoolClient, id: string): Promise<Directive> {
  const parsed = parseInput(publicIdQuerySchema, { id }, 'getDirective');
  const result = await tx.query(
    `SELECT ${DIRECTIVE_COLUMNS} FROM control_center.directives WHERE id = $1`,
    [parsed.id],
  );
  if (result.rowCount !== 1) {
    throw new NotFoundError(`directive ${parsed.id} not found`);
  }
  return mapDirective(result.rows[0] as DirectiveRow);
}

export async function getRevision(tx: PoolClient, id: string): Promise<DirectiveRevision> {
  const parsed = parseInput(publicIdQuerySchema, { id }, 'getRevision');
  const result = await tx.query(
    `SELECT ${REVISION_COLUMNS} FROM control_center.directive_revisions WHERE id = $1`,
    [parsed.id],
  );
  if (result.rowCount !== 1) {
    throw new NotFoundError(`directive revision ${parsed.id} not found`);
  }
  return mapRevision(result.rows[0] as DirectiveRevisionRow);
}

export async function listCurrentDirectivesByScope(
  tx: PoolClient,
  scope: string,
): Promise<CurrentDirective[]> {
  const parsed = parseInput(scopeQuerySchema, { scope }, 'listCurrentDirectivesByScope');
  const result = await tx.query(
    `SELECT ${CURRENT_COLUMNS}
     FROM control_center.current_directives
     WHERE scope = $1
     ORDER BY effective_from DESC, directive_id ASC`,
    [parsed.scope],
  );
  return result.rows.map((row) => mapCurrentDirective(row as CurrentDirectiveRow));
}

export async function listAllCurrentDirectives(tx: PoolClient): Promise<CurrentDirective[]> {
  const result = await tx.query(
    `SELECT ${CURRENT_COLUMNS}
     FROM control_center.current_directives
     ORDER BY effective_from DESC, directive_id ASC`,
  );
  return result.rows.map((row) => mapCurrentDirective(row as CurrentDirectiveRow));
}

export async function listAllRevisions(tx: PoolClient): Promise<DirectiveRevision[]> {
  const result = await tx.query(
    `SELECT ${REVISION_COLUMNS}
     FROM control_center.directive_revisions
     ORDER BY directive_id ASC, revision_no ASC`,
  );
  return result.rows.map((row) => mapRevision(row as DirectiveRevisionRow));
}

export async function listRevisionsByScope(
  tx: PoolClient,
  scope: string,
  directiveId: string,
): Promise<DirectiveRevision[]> {
  const parsed = parseInput(scopedIdQuerySchema, { scope, id: directiveId }, 'listRevisionsByScope');
  const result = await tx.query(
    `SELECT ${REVISION_COLUMNS}
     FROM control_center.directive_revisions
     WHERE directive_id = $1 AND scope = $2
     ORDER BY revision_no ASC`,
    [parsed.id, parsed.scope],
  );
  return result.rows.map((row) => mapRevision(row as DirectiveRevisionRow));
}
