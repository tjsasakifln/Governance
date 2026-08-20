import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { DIRECTIVE_KINDS, ValidationError, migrateUp } from '../src/index.js';
import { startTestPostgres, type TestPostgres } from './helpers/postgres.js';

let ctx: TestPostgres;

before(async () => {
  ctx = await startTestPostgres();
  await migrateUp(ctx.pool);
});

after(async () => {
  await ctx.stop();
});

function provenance(scope: string) {
  return {
    scope,
    source: 'synthetic-test',
    observedAt: new Date('2026-04-01T00:00:00.000Z'),
    freshnessStatus: 'fresh' as const,
    confidence: 0.75,
    createdBy: 'synthetic-operator-01',
  };
}

test('each directive kind can be inserted and superseded without rewriting original revision', async () => {
  for (const kind of DIRECTIVE_KINDS) {
    const created = await ctx.persistence.createDirective({
      kind,
      title: `Synthetic ${kind}`,
      body: `Body for ${kind}`,
      effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
      ...provenance('ops.exceptions'),
    });
    const original = await ctx.pool.query(
      `SELECT id, directive_id, revision_no, kind, title, body, status, source, observed_at, freshness_status
       FROM control_center.directive_revisions WHERE id = $1`,
      [created.revision.id],
    );
    assert.equal(original.rowCount, 1);
    const snapshot = JSON.stringify(original.rows[0]);

    const superseded = await ctx.persistence.supersedeDirective({
      existingId: created.directive.id,
      kind,
      title: `Synthetic ${kind} replacement`,
      body: `Replacement for ${kind}`,
      effectiveFrom: new Date('2026-04-02T00:00:00.000Z'),
      ...provenance('ops.exceptions'),
    });

    assert.equal(superseded.replacement.supersedes, created.directive.id);
    assert.equal(superseded.superseded.status, 'superseded');
    assert.notEqual(superseded.supersededRevision.id, created.revision.id);
    assert.notEqual(superseded.replacement.currentRevisionId, created.revision.id);

    const after = await ctx.pool.query(
      `SELECT id, directive_id, revision_no, kind, title, body, status, source, observed_at, freshness_status
       FROM control_center.directive_revisions WHERE id = $1`,
      [created.revision.id],
    );
    assert.equal(JSON.stringify(after.rows[0]), snapshot);

    const current = await ctx.persistence.listCurrentDirectivesByScope('ops.exceptions');
    assert.ok(current.some((row) => row.directiveId === superseded.replacement.id && row.status === 'active'));
    assert.ok(current.some((row) => row.directiveId === created.directive.id && row.status === 'superseded'));
  }
});

test('directive_revisions and audit_events reject UPDATE/DELETE and keep original rows', async () => {
  const created = await ctx.persistence.createDirective({
    kind: 'constraint',
    title: 'Append-only fixture',
    body: 'Must not be rewritten',
    effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    ...provenance('strategy'),
  });
  const audit = await ctx.persistence.appendAuditEvent({
    actor: 'synthetic-operator-01',
    action: 'append-only.check',
    entityType: 'directive',
    entityId: created.directive.id,
    scope: 'strategy',
    payload: { marker: 'original' },
    source: 'synthetic-test',
    observedAt: new Date('2026-04-01T00:00:00.000Z'),
    freshnessStatus: 'fresh',
  });

  const revisionBefore = await ctx.pool.query(
    `SELECT * FROM control_center.directive_revisions WHERE id = $1`,
    [created.revision.id],
  );
  const auditBefore = await ctx.pool.query(
    `SELECT * FROM control_center.audit_events WHERE id = $1`,
    [audit.id],
  );

  await assert.rejects(
    () =>
      ctx.pool.query(`UPDATE control_center.directive_revisions SET title = 'mutated' WHERE id = $1`, [
        created.revision.id,
      ]),
    /append-only/,
  );
  await assert.rejects(
    () => ctx.pool.query(`DELETE FROM control_center.directive_revisions WHERE id = $1`, [created.revision.id]),
    /append-only/,
  );
  await assert.rejects(
    () => ctx.pool.query(`UPDATE control_center.audit_events SET action = 'mutated' WHERE id = $1`, [audit.id]),
    /append-only/,
  );
  await assert.rejects(
    () => ctx.pool.query(`DELETE FROM control_center.audit_events WHERE id = $1`, [audit.id]),
    /append-only/,
  );

  const revisionAfter = await ctx.pool.query(
    `SELECT * FROM control_center.directive_revisions WHERE id = $1`,
    [created.revision.id],
  );
  const auditAfter = await ctx.pool.query(
    `SELECT * FROM control_center.audit_events WHERE id = $1`,
    [audit.id],
  );
  assert.equal(JSON.stringify(revisionAfter.rows[0]), JSON.stringify(revisionBefore.rows[0]));
  assert.equal(JSON.stringify(auditAfter.rows[0]), JSON.stringify(auditBefore.rows[0]));
});

test('scope-filtered reads do not return other scopes', async () => {
  await ctx.persistence.createDirective({
    kind: 'fact',
    title: 'Scope A',
    body: 'A',
    effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    ...provenance('scope.a'),
  });
  await ctx.persistence.createDirective({
    kind: 'fact',
    title: 'Scope B',
    body: 'B',
    effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    ...provenance('scope.b'),
  });
  const onlyA = await ctx.persistence.listCurrentDirectivesByScope('scope.a');
  assert.ok(onlyA.length >= 1);
  assert.ok(onlyA.every((row) => row.scope === 'scope.a'));
  assert.ok(onlyA.every((row) => row.title !== 'Scope B'));
});

test('aggregated rows reject missing source, observed_at, and freshness_status', async () => {
  await assert.rejects(
    () =>
      ctx.persistence.recordObservation({
        scope: 'ops.exceptions',
        observationKind: 'missing-source',
        idempotencyKey: 'missing-source-1',
        source: '',
        observedAt: new Date('2026-04-01T00:00:00.000Z'),
        freshnessStatus: 'fresh',
      }),
    ValidationError,
  );
  await assert.rejects(
    () =>
      ctx.pool.query(
        `INSERT INTO control_center.source_observations (
           source, observed_at, freshness_status, scope, observation_kind, payload, idempotency_key
         ) VALUES (NULL, now(), 'fresh', 'ops.exceptions', 'x', '{}'::jsonb, 'raw-null-source')`,
      ),
  );
  await assert.rejects(
    () =>
      ctx.pool.query(
        `INSERT INTO control_center.source_observations (
           source, observed_at, freshness_status, scope, observation_kind, payload, idempotency_key
         ) VALUES ('synthetic-test', NULL, 'fresh', 'ops.exceptions', 'x', '{}'::jsonb, 'raw-null-observed')`,
      ),
  );
  await assert.rejects(
    () =>
      ctx.pool.query(
        `INSERT INTO control_center.source_observations (
           source, observed_at, freshness_status, scope, observation_kind, payload, idempotency_key
         ) VALUES ('synthetic-test', now(), NULL, 'ops.exceptions', 'x', '{}'::jsonb, 'raw-null-freshness')`,
      ),
  );
  await assert.rejects(
    () =>
      ctx.pool.query(
        `INSERT INTO control_center.operational_snapshots (
           scope, snapshot_kind, source, observed_at, freshness_status, payload
         ) VALUES ('ops.exceptions', 'brief', NULL, now(), 'fresh', '{}'::jsonb)`,
      ),
  );
});

test('money fields round-trip as integer cents plus currency', async () => {
  const snapshot = await ctx.persistence.recordSnapshot({
    scope: 'commercial.pipeline',
    snapshotKind: 'exceptions-brief',
    payload: { items: 3 },
    money: { amountCents: 150075, currency: 'BRL' },
    source: 'synthetic-test',
    observedAt: new Date('2026-04-01T00:00:00.000Z'),
    freshnessStatus: 'fresh',
    confidence: 0.5,
  });
  assert.equal(snapshot.money?.amountCents, 150075);
  assert.equal(snapshot.money?.currency, 'BRL');
  assert.equal(Number.isInteger(snapshot.money?.amountCents), true);

  const raw = await ctx.pool.query<{ money_amount_cents: string; money_currency: string }>(
    `SELECT money_amount_cents, money_currency FROM control_center.operational_snapshots WHERE id = $1`,
    [snapshot.id],
  );
  assert.equal(Number(raw.rows[0]?.money_amount_cents), 150075);
  assert.equal(raw.rows[0]?.money_currency, 'BRL');
});
