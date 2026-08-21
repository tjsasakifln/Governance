import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ClientOpsError,
  FRESHNESS_STATUSES,
  collectKeys,
  createClientOps,
  findSensitiveHits,
  isUtcDateTime,
  serializeClientStatus,
  toHomepageAttention,
  type ClientStatus,
  type Provenance,
} from "../src/index.js";
import {
  FIXED_NOW,
  HEALTHY_SLUG,
  NEEDY_SLUG,
  RESOLVED_SLUG,
  WEEK_DUE_SLUG,
  fixturePayloads,
  lesteObrasPayload,
  norteEngenhariaPayload,
  oesteProjetoPayload,
  sulConsultoriaPayload,
} from "./fixtures.js";

function loadOps() {
  const ops = createClientOps({ now: FIXED_NOW });
  for (const payload of fixturePayloads()) {
    ops.ingest(payload);
  }
  return ops;
}

function assertProvenance(provenance: Provenance, label: string): void {
  assert.equal(typeof provenance.source, "string", `${label}.source`);
  assert.ok(provenance.source.length > 0, `${label}.source nonempty`);
  assert.ok(isUtcDateTime(provenance.observed_at), `${label}.observed_at UTC`);
  assert.ok(
    (FRESHNESS_STATUSES as readonly string[]).includes(provenance.freshness_status),
    `${label}.freshness_status`,
  );
  if (provenance.confidence !== undefined) {
    assert.ok(provenance.confidence >= 0 && provenance.confidence <= 1, `${label}.confidence`);
  }
}

function assertEveryFactHasProvenance(status: ClientStatus): void {
  assertProvenance(status.provenance, "envelope");
  assertProvenance(status.health.provenance, "health");
  if (status.next_action) {
    assertProvenance(status.next_action.provenance, "next_action");
  }
  for (const item of status.commitments) {
    assertProvenance(item.provenance, `commitment:${item.id}`);
  }
  for (const item of status.blockers) {
    assertProvenance(item.provenance, `blocker:${item.id}`);
  }
  for (const item of status.deliverables) {
    assertProvenance(item.provenance, `deliverable:${item.id}`);
  }
  for (const item of status.risk) {
    assertProvenance(item.provenance, `risk:${item.id}`);
  }
  for (const item of status.due_dates) {
    assertProvenance(item.provenance, `due_date:${item.ref}`);
  }
}

describe("ClientStatus ingest/build", () => {
  test("builds a mixed-source read model with health, commitments, next action, due dates, blockers, deliverables, risk", () => {
    const ops = loadOps();
    const norte = ops.getClient(NEEDY_SLUG);
    assert.ok(norte, "norte-engenharia must exist");
    assert.equal(norte.client_slug, NEEDY_SLUG);
    assert.equal(norte.display_name, "Norte Engenharia");
    assert.equal(norte.schema_version, "control-center.client-status.v1");
    assert.equal(norte.scope, `client:${NEEDY_SLUG}`);
    assert.equal(norte.id, `cc:client-status:${NEEDY_SLUG}`);
    assert.ok(norte.health);
    assert.equal(typeof norte.health.score, "number");
    assert.ok(norte.commitments.length >= 1);
    assert.ok(norte.next_action);
    assert.ok(norte.due_dates.length >= 1);
    assert.ok(norte.blockers.length >= 1);
    assert.ok(norte.deliverables.length >= 1);
    assert.ok(norte.risk.length >= 1);
    assertEveryFactHasProvenance(norte);

    const commitment = norte.commitments.find((item) => item.id === "c-relatorio-mensal");
    assert.ok(commitment);
    assert.equal(commitment.provenance.source, "governance");
    const blocker = norte.blockers.find((item) => item.id === "b-acesso-homolog");
    assert.ok(blocker);
    assert.equal(blocker.provenance.source, "manual");
    const risk = norte.risk.find((item) => item.id === "r-escopo");
    assert.ok(risk);
    assert.equal(risk.provenance.source, "adapter:delivery");
    assert.equal(risk.provenance.confidence, 0.7);
    assert.equal(norte.provenance.source, "manual");
  });

  test("commitment round-trips owner, due_at, evidence_ref, status", () => {
    const ops = loadOps();
    const norte = ops.getClient(NEEDY_SLUG);
    assert.ok(norte);
    const commitment = norte.commitments.find((item) => item.id === "c-relatorio-mensal");
    assert.ok(commitment);
    assert.equal(commitment.owner, "founder");
    assert.equal(commitment.due_at, "2026-08-18T12:00:00.000Z");
    assert.equal(commitment.evidence_ref, "governance:decision/relatorio-mensal-2026-08");
    assert.equal(commitment.status, "open");
  });

  test("rejects ingest without envelope provenance fields", () => {
    const ops = createClientOps({ now: FIXED_NOW });
    const missingObserved = norteEngenhariaPayload();
    delete missingObserved.observed_at;
    assert.throws(
      () => ops.ingest(missingObserved),
      (err: unknown) => err instanceof ClientOpsError && err.code === "missing_provenance",
    );

    const missingSource = norteEngenhariaPayload();
    delete missingSource.source;
    assert.throws(
      () => ops.ingest(missingSource),
      (err: unknown) => err instanceof ClientOpsError && err.code === "missing_provenance",
    );

    const missingFreshness = norteEngenhariaPayload();
    delete missingFreshness.freshness_status;
    assert.throws(
      () => ops.ingest(missingFreshness),
      (err: unknown) => err instanceof ClientOpsError && err.code === "missing_provenance",
    );
  });

  test("rejects a commitment without provenance", () => {
    const ops = createClientOps({ now: FIXED_NOW });
    const payload = norteEngenhariaPayload();
    const commitments = payload.commitments as Array<Record<string, unknown>>;
    const first = commitments[0];
    assert.ok(first);
    delete first.provenance;
    assert.throws(
      () => ops.ingest(payload),
      (err: unknown) => err instanceof ClientOpsError && err.code === "missing_provenance",
    );
  });

  test("rejects sensitive extra fields", () => {
    const ops = createClientOps({ now: FIXED_NOW });
    const withCpf = { ...norteEngenhariaPayload(), cpf: "123.456.789-00" };
    assert.throws(
      () => ops.ingest(withCpf),
      (err: unknown) => err instanceof ClientOpsError && err.code === "sensitive_field",
    );
    const withPassword = { ...norteEngenhariaPayload(), password: "not-a-real-secret" };
    assert.throws(
      () => ops.ingest(withPassword),
      (err: unknown) => err instanceof ClientOpsError && err.code === "sensitive_field",
    );
  });

  test("ingest is idempotent for the same snapshot", () => {
    const ops = createClientOps({ now: FIXED_NOW });
    const first = ops.ingest(norteEngenhariaPayload());
    const second = ops.ingest(norteEngenhariaPayload());
    assert.equal(serializeClientStatus(first), serializeClientStatus(second));
  });
});

describe("queries", () => {
  test("attention names the client that needs the operator now, with why and next action", () => {
    const ops = loadOps();
    const attention = ops.queryAttention();
    const needy = attention.find((item) => item.client_slug === NEEDY_SLUG);
    assert.ok(needy, "norte-engenharia must require attention");
    assert.ok(needy.why.length > 0, "why must be non-empty");
    assert.ok(needy.why.some((line) => /vencido/i.test(line)));
    assert.ok(needy.why.some((line) => /bloqueio/i.test(line)));
    assert.ok(needy.why.some((line) => /risco/i.test(line)));
    assert.ok(needy.next_action);
    assert.ok(needy.next_action.summary.trim().length > 0);
    assert.match(needy.next_action.summary, /homolog/i);

    const homepage = toHomepageAttention(needy);
    assert.equal(homepage.client_slug, NEEDY_SLUG);
    assert.equal(homepage.display_name, "Norte Engenharia");
    assert.ok(homepage.why.length > 0);
    assert.ok(homepage.next_action_summary.length > 0);

    const healthy = attention.find((item) => item.client_slug === HEALTHY_SLUG);
    assert.equal(healthy, undefined, "healthy client must not appear in attention");
    const resolved = attention.find((item) => item.client_slug === RESOLVED_SLUG);
    assert.equal(resolved, undefined);
  });

  test("due-commitments lists overdue/due items and omits far-future and done", () => {
    const ops = loadOps();
    const due = ops.queryDueCommitments();
    const ids = due.map((item) => item.commitment.id);
    assert.ok(ids.includes("c-relatorio-mensal"), "overdue commitment must be listed");
    assert.ok(ids.includes("c-parecer-tecnico"), "commitment due this week must be listed");
    assert.ok(!ids.includes("c-revisao-trimestral"), "far-future commitment must be omitted");
    assert.ok(!ids.includes("c-kickoff"), "done commitment must be omitted");
    const overdue = due.find((item) => item.commitment.id === "c-relatorio-mensal");
    assert.equal(overdue?.overdue, true);
    const week = due.find((item) => item.commitment.id === "c-parecer-tecnico");
    assert.equal(week?.overdue, false);
  });

  test("blockers query lists open blockers and omits resolved", () => {
    const ops = loadOps();
    const blockers = ops.queryOpenBlockers();
    const ids = blockers.map((item) => item.blocker.id);
    assert.ok(ids.includes("b-acesso-homolog"));
    assert.ok(!ids.includes("b-vpn-antiga"));
    assert.equal(
      blockers.find((item) => item.client_slug === RESOLVED_SLUG),
      undefined,
    );
  });

  test("scoped read for one client does not return another client's records", () => {
    const ops = loadOps();
    const scope = `client:${NEEDY_SLUG}`;
    const attention = ops.queryAttention({ scope });
    assert.ok(attention.every((item) => item.client_slug === NEEDY_SLUG));
    assert.equal(
      attention.find((item) => item.client_slug === HEALTHY_SLUG),
      undefined,
    );

    const due = ops.queryDueCommitments({ scope });
    assert.ok(due.every((item) => item.client_slug === NEEDY_SLUG));
    assert.equal(
      due.find((item) => item.client_slug === WEEK_DUE_SLUG),
      undefined,
    );

    const blockers = ops.queryOpenBlockers({ scope });
    assert.ok(blockers.every((item) => item.client_slug === NEEDY_SLUG));

    const listed = ops.list(scope);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.client_slug, NEEDY_SLUG);

    const healthyScope = ops.queryAttention({ scope: `client:${HEALTHY_SLUG}` });
    assert.equal(healthyScope.length, 0);

    const healthyRecord = ops.getClient(HEALTHY_SLUG);
    assert.ok(healthyRecord);
    assert.equal(healthyRecord.client_slug, HEALTHY_SLUG);
    const serializedHealthy = serializeClientStatus(healthyRecord);
    assert.equal(serializedHealthy.includes(NEEDY_SLUG), false);
  });

  test("serialized ClientStatus has no password/secret/CPF/PAN-like fields", () => {
    const ops = loadOps();
    for (const record of ops.list()) {
      const json = serializeClientStatus(record);
      const parsed: unknown = JSON.parse(json);
      const keys = collectKeys(parsed);
      for (const key of keys) {
        assert.doesNotMatch(
          key,
          /password|secret|token|cpf|cnpj|pan|cvv|ssn|authorization|api[_-]?key/i,
        );
      }
      assert.equal(findSensitiveHits(parsed).length, 0, record.client_slug);
      assert.doesNotMatch(json, /\d{3}\.\d{3}\.\d{3}-\d{2}/);
      assert.doesNotMatch(json, /\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}/);
    }
  });
});

describe("fixtures stay PII-free", () => {
  test("synthetic fixtures do not include extra identity fields", () => {
    for (const payload of [
      norteEngenhariaPayload(),
      sulConsultoriaPayload(),
      lesteObrasPayload(),
      oesteProjetoPayload(),
    ]) {
      assert.equal(findSensitiveHits(payload).length, 0);
    }
  });
});
