import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  ValidationError,
  isConfidence,
  isDirectiveStatus,
  isFreshnessStatus,
  isResourceId,
  isScope,
  isSourceRef,
  isUuid,
  migrateUp,
} from '../src/index.js';
import { SAMPLE_UUID, SYNTHETIC_SOURCE, provenance } from './helpers/fixtures.js';
import { startTestPostgres, type TestPostgres } from './helpers/postgres.js';

let ctx: TestPostgres;

before(async () => {
  ctx = await startTestPostgres();
  await migrateUp(ctx.pool);
});

after(async () => {
  await ctx.stop();
});

test('pure validators accept canonical tokens and reject drift', () => {
  assert.equal(isFreshnessStatus('FRESH'), true);
  assert.equal(isFreshnessStatus('STALE'), true);
  assert.equal(isFreshnessStatus('UNKNOWN'), true);
  assert.equal(isFreshnessStatus('ERROR'), true);
  assert.equal(isFreshnessStatus('fresh'), false);
  assert.equal(isFreshnessStatus('error'), false);
  assert.equal(isFreshnessStatus('expired'), false);
  assert.equal(isDirectiveStatus('revoked'), true);
  assert.equal(isDirectiveStatus('withdrawn'), false);
  assert.equal(isScope('company'), true);
  assert.equal(isScope('commercial'), true);
  assert.equal(isScope('repo:confenge/Governance'), true);
  assert.equal(isScope('client:acme-co'), true);
  assert.equal(isScope('ops:exceptions'), true);
  assert.equal(isScope('ops.exceptions'), false);
  assert.equal(isScope('company:foo'), false);
  assert.equal(isResourceId('cc:directive:synthetic-one'), true);
  assert.equal(isResourceId(SAMPLE_UUID), false);
  assert.equal(isUuid(SAMPLE_UUID), true);
  assert.equal(isUuid('cc:directive:synthetic-one'), false);
  assert.equal(isConfidence(0), true);
  assert.equal(isConfidence(1), true);
  assert.equal(isConfidence(1.1), false);
  assert.equal(isSourceRef(SYNTHETIC_SOURCE), true);
  assert.equal(isSourceRef('manual'), false);
  assert.equal(isSourceRef({ system: 'Manual', kind: 'fixture', locator: 'x' }), false);
});

test('API validation rejects lowercase freshness, expired-as-freshness, withdrawn, UUID public id, and non-canonical scope', async () => {
  const base = {
    kind: 'fact' as const,
    title: 'Rejected',
    body: 'Must fail closed',
    effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    ...provenance('company'),
  };

  await assert.rejects(
    () => ctx.persistence.createDirective({ ...base, freshnessStatus: 'fresh' as never }),
    ValidationError,
  );
  await assert.rejects(
    () => ctx.persistence.createDirective({ ...base, freshnessStatus: 'error' as never }),
    ValidationError,
  );
  await assert.rejects(
    () => ctx.persistence.createDirective({ ...base, freshnessStatus: 'expired' as never }),
    ValidationError,
  );
  await assert.rejects(
    () => ctx.persistence.createDirective({ ...base, status: 'withdrawn' as never }),
    ValidationError,
  );
  await assert.rejects(
    () => ctx.persistence.createDirective({ ...base, scope: 'ops.exceptions' }),
    ValidationError,
  );
  await assert.rejects(
    () => ctx.persistence.createDirective({ ...base, supersedes: [SAMPLE_UUID] }),
    ValidationError,
  );
  await assert.rejects(
    () => ctx.persistence.createDirective({ ...base, source: 'synthetic-test' as never }),
    ValidationError,
  );
  await assert.rejects(() => ctx.persistence.getDirective(SAMPLE_UUID), ValidationError);
  await assert.rejects(
    () =>
      ctx.persistence.recordObservation({
        scope: 'commercial',
        observationKind: 'bad-freshness',
        idempotencyKey: 'bad-freshness-1',
        source: SYNTHETIC_SOURCE,
        observedAt: new Date('2026-04-01T00:00:00.000Z'),
        freshnessStatus: 'expired' as never,
        confidence: 0.4,
      }),
    ValidationError,
  );
});

test('SQL CHECKs reject lowercase freshness, expired-as-freshness, withdrawn, UUID public id, and non-canonical scope', async () => {
  await assert.rejects(() =>
    ctx.pool.query(
      `INSERT INTO control_center.source_observations (
         id, source_system, source_kind, source_locator, observed_at, freshness_status,
         confidence, scope, observation_kind, payload, idempotency_key
       ) VALUES (
         'cc:source-observation:lower-fresh', 'manual', 'fixture', 'x', now(), 'fresh',
         0.5, 'commercial', 'x', '{}'::jsonb, 'lower-fresh'
       )`,
    ),
  );
  await assert.rejects(() =>
    ctx.pool.query(
      `INSERT INTO control_center.source_observations (
         id, source_system, source_kind, source_locator, observed_at, freshness_status,
         confidence, scope, observation_kind, payload, idempotency_key
       ) VALUES (
         'cc:source-observation:expired-fresh', 'manual', 'fixture', 'x', now(), 'expired',
         0.5, 'commercial', 'x', '{}'::jsonb, 'expired-fresh'
       )`,
    ),
  );
  await assert.rejects(() =>
    ctx.pool.query(
      `INSERT INTO control_center.source_observations (
         id, source_system, source_kind, source_locator, observed_at, freshness_status,
         confidence, scope, observation_kind, payload, idempotency_key
       ) VALUES (
         'cc:source-observation:lower-error', 'manual', 'fixture', 'x', now(), 'error',
         0.5, 'commercial', 'x', '{}'::jsonb, 'lower-error'
       )`,
    ),
  );
  await assert.rejects(() =>
    ctx.pool.query(
      `INSERT INTO control_center.source_observations (
         id, source_system, source_kind, source_locator, observed_at, freshness_status,
         confidence, scope, observation_kind, payload, idempotency_key
       ) VALUES (
         '${SAMPLE_UUID}', 'manual', 'fixture', 'x', now(), 'FRESH',
         0.5, 'commercial', 'x', '{}'::jsonb, 'uuid-public-id'
       )`,
    ),
  );
  await assert.rejects(() =>
    ctx.pool.query(
      `INSERT INTO control_center.source_observations (
         id, source_system, source_kind, source_locator, observed_at, freshness_status,
         confidence, scope, observation_kind, payload, idempotency_key
       ) VALUES (
         'cc:source-observation:bad-scope', 'manual', 'fixture', 'x', now(), 'FRESH',
         0.5, 'ops.exceptions', 'x', '{}'::jsonb, 'bad-scope'
       )`,
    ),
  );
  await assert.rejects(() =>
    ctx.pool.query(
      `INSERT INTO control_center.directives (
         id, kind, scope, status, title, body, effective_from, created_by
       ) VALUES (
         'cc:directive:withdrawn-row', 'fact', 'company', 'withdrawn', 'x', 'y', now(), 'synthetic-operator-01'
       )`,
    ),
  );
});

test('FRESH STALE UNKNOWN ERROR round-trip and ERROR is preserved', async () => {
  const tokens = ['FRESH', 'STALE', 'UNKNOWN', 'ERROR'] as const;
  for (const freshnessStatus of tokens) {
    const key = `round-trip-${freshnessStatus}`;
    const recorded = await ctx.persistence.recordObservation({
      scope: 'infrastructure',
      observationKind: 'freshness-round-trip',
      idempotencyKey: key,
      payload: { token: freshnessStatus },
      source: { system: 'collector', kind: 'health', locator: key },
      observedAt: new Date('2026-04-01T00:00:00.000Z'),
      freshnessStatus,
      confidence: 0.42,
    });
    assert.equal(recorded.observation.freshnessStatus, freshnessStatus);
    assert.match(recorded.observation.id, /^cc:source-observation:/);
    assert.equal(recorded.observation.source.system, 'collector');
    assert.equal(recorded.observation.source.kind, 'health');
    assert.equal(recorded.observation.source.locator, key);
    assert.equal(recorded.observation.confidence, 0.42);
    assert.equal(recorded.observation.observedAt.toISOString().endsWith('Z'), true);

    const listed = await ctx.persistence.listObservationsByScope('infrastructure');
    const found = listed.find((row) => row.idempotencyKey === key);
    assert.ok(found);
    assert.equal(found?.freshnessStatus, freshnessStatus);

    const raw = await ctx.pool.query<{ freshness_status: string }>(
      `SELECT freshness_status FROM control_center.source_observations WHERE id = $1`,
      [recorded.observation.id],
    );
    assert.equal(raw.rows[0]?.freshness_status, freshnessStatus);
  }

  const errorRow = await ctx.persistence.recordObservation({
    scope: 'infrastructure',
    observationKind: 'preserve-error',
    idempotencyKey: 'preserve-error-1',
    source: { system: 'collector', kind: 'health', locator: 'preserve-error-1' },
    observedAt: new Date('2026-04-01T00:00:00.000Z'),
    freshnessStatus: 'ERROR',
    confidence: 0.1,
  });
  const reread = await ctx.persistence.listObservationsByScope('infrastructure');
  const preserved = reread.find((row) => row.id === errorRow.observation.id);
  assert.equal(preserved?.freshnessStatus, 'ERROR');
});

test('SourceRef round-trips structured and is not flattened to a source string column', async () => {
  const recorded = await ctx.persistence.recordObservation({
    scope: 'inbound',
    observationKind: 'source-ref',
    idempotencyKey: 'source-ref-structured-1',
    source: { system: 'github', kind: 'issue', locator: 'confenge/Governance#24', label: 'pr-24' },
    observedAt: new Date('2026-04-01T00:00:00.000Z'),
    freshnessStatus: 'FRESH',
    confidence: 0.99,
  });
  assert.deepEqual(recorded.observation.source, {
    system: 'github',
    kind: 'issue',
    locator: 'confenge/Governance#24',
    label: 'pr-24',
  });
  const cols = await ctx.pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'control_center' AND table_name = 'source_observations'`,
  );
  const names = cols.rows.map((row) => row.column_name);
  assert.equal(names.includes('source'), false);
  assert.ok(names.includes('source_system'));
  assert.ok(names.includes('source_kind'));
  assert.ok(names.includes('source_locator'));
  const stored = await ctx.pool.query<{
    source_system: string;
    source_kind: string;
    source_locator: string;
    source_label: string;
  }>(
    `SELECT source_system, source_kind, source_locator, source_label
     FROM control_center.source_observations WHERE id = $1`,
    [recorded.observation.id],
  );
  assert.equal(stored.rows[0]?.source_system, 'github');
  assert.equal(stored.rows[0]?.source_kind, 'issue');
  assert.equal(stored.rows[0]?.source_locator, 'confenge/Governance#24');
  assert.equal(stored.rows[0]?.source_label, 'pr-24');
});

test('supersedes is a list of public cc:* ids stored on the join table', async () => {
  const first = await ctx.persistence.createDirective({
    kind: 'decision',
    title: 'Original list target',
    body: 'First',
    effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    ...provenance('company'),
  });
  const second = await ctx.persistence.createDirective({
    kind: 'decision',
    title: 'Second list target',
    body: 'Second',
    effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    ...provenance('company'),
  });
  const replacement = await ctx.persistence.createDirective({
    kind: 'decision',
    title: 'Replacement with list',
    body: 'List',
    effectiveFrom: new Date('2026-04-02T00:00:00.000Z'),
    supersedes: [first.directive.id, second.directive.id],
    ...provenance('company'),
  });
  assert.deepEqual(replacement.directive.supersedes.sort(), [first.directive.id, second.directive.id].sort());
  assert.ok(replacement.directive.supersedes.every((id) => id.startsWith('cc:directive:')));
  const join = await ctx.pool.query<{ superseded_id: string }>(
    `SELECT superseded_id FROM control_center.directive_supersedes WHERE directive_id = $1 ORDER BY superseded_id`,
    [replacement.directive.id],
  );
  assert.equal(join.rowCount, 2);
  const loaded = await ctx.persistence.getDirective(replacement.directive.id);
  assert.equal(loaded.supersedes.length, 2);
});

test('AgentActivity is persisted separately from AgentSession', async () => {
  const beforeSessions = await ctx.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM control_center.agent_sessions`,
  );
  const activity = await ctx.persistence.recordAgentActivity({
    correlationId: 'synthetic-activity-separation-1',
    agentId: 'synthetic-agent-01',
    scope: 'company',
    status: 'DONE',
    goal: 'Prove activity is not a session',
    summary: 'Stored on agent_activities only.',
    source: { system: 'agent', kind: 'report', locator: 'synthetic-activity-separation-1' },
    observedAt: new Date('2026-04-01T00:00:00.000Z'),
    freshnessStatus: 'FRESH',
    confidence: 0.8,
  });
  assert.match(activity.activity.id, /^cc:agent-activity:/);
  assert.equal(activity.inserted, true);
  const listed = await ctx.persistence.listAgentActivitiesByScope('company');
  assert.ok(listed.some((row) => row.id === activity.activity.id));
  const sessions = await ctx.persistence.listAgentSessionsByScope('company');
  assert.equal(
    sessions.some((row) => row.id === activity.activity.id),
    false,
  );
  const leaked = await ctx.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM control_center.agent_sessions WHERE id = $1`,
    [activity.activity.id],
  );
  assert.equal(leaked.rows[0]?.n, 0);
  const afterSessions = await ctx.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM control_center.agent_sessions`,
  );
  assert.equal(afterSessions.rows[0]?.n, beforeSessions.rows[0]?.n);
  const stored = await ctx.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM control_center.agent_activities WHERE id = $1`,
    [activity.activity.id],
  );
  assert.equal(stored.rows[0]?.n, 1);
  await assert.rejects(
    () =>
      ctx.pool.query(`UPDATE control_center.agent_activity_revisions SET summary = 'mutated' WHERE activity_id = $1`, [
        activity.activity.id,
      ]),
    /append-only/,
  );
});

test('internal_uuid surrogate is never returned as the public identity', async () => {
  const created = await ctx.persistence.createDirective({
    kind: 'risk',
    title: 'UUID must stay internal',
    body: 'Public id is cc:*',
    effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    ...provenance('company'),
  });
  assert.equal(isUuid(created.directive.id), false);
  assert.equal(isResourceId(created.directive.id), true);
  const row = await ctx.pool.query<{ id: string; internal_uuid: string }>(
    `SELECT id, internal_uuid FROM control_center.directives WHERE id = $1`,
    [created.directive.id],
  );
  assert.equal(row.rows[0]?.id, created.directive.id);
  assert.equal(isUuid(row.rows[0]?.internal_uuid ?? ''), true);
  assert.notEqual(created.directive.id, row.rows[0]?.internal_uuid);
  assert.equal(JSON.stringify(created.directive).includes(row.rows[0]?.internal_uuid ?? 'missing'), false);
});
