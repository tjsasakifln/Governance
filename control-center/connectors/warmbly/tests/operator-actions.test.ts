import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgentLedger } from "@confenge/control-center-agent-activity";
import { classifyRequest } from "../src/http/allowlist.ts";
import { CircuitBreaker } from "../src/http/circuit-breaker.ts";
import { WarmblyClient } from "../src/http/client.ts";
import { startFixtureStub } from "../src/stub-server.ts";
import {
  DISPATCH_TARGET_ID,
  OPERATOR_ACTIONS,
  OPERATOR_ACTION_NAMES,
  OPERATOR_FORBIDDEN_ACTIONS,
  WarmblyOperatorClient,
  classifyOperatorRequest,
  createAgentActivityLedgerSink,
  createFanOutOperatorActionLedger,
  createMemoryOperatorActionLedger,
  createOperatorHttpHandler,
  createWarmblyOperatorChannel,
  defaultOperatorIdentityPolicy,
  OPERATOR_HTTP_ROUTES,
  resolveOperatorAction,
  type OperatorActionLedgerEntry,
  type WarmblyOperatorChannel,
} from "../src/operator/index.ts";
import { capturingLogger, loadFixture } from "./helpers.ts";

const TOKEN = "wmbly_super_secret_operator_token_do_not_log";
const TRUSTED_HOP = "10.89.0.2";

const AUTHELIA_HEADERS = {
  "Remote-User": "founder",
  "Remote-Groups": "operators",
  "Remote-Name": "Founder Confenge",
  "Remote-Email": "founder@confenge.invalid",
};

function founderRequest(headers: Record<string, string | string[] | undefined> = AUTHELIA_HEADERS) {
  return { remoteAddress: TRUSTED_HOP, headers };
}

type Harness = {
  channel: WarmblyOperatorChannel;
  ledger: ReturnType<typeof createMemoryOperatorActionLedger>;
  stub: Awaited<ReturnType<typeof startFixtureStub>>;
  fetchHits: Array<{ method: string; url: string }>;
  close: () => Promise<void>;
};

async function harness(
  options: {
    operatorWrites?: boolean;
    operatorWriteStatus?: number;
    breaker?: CircuitBreaker;
    confirmationTtlMs?: number;
    now?: () => Date;
    extraLedgers?: ReturnType<typeof createMemoryOperatorActionLedger>[];
    sink?: ReturnType<typeof createAgentActivityLedgerSink>;
  } = {},
): Promise<Harness> {
  const stub = await startFixtureStub({
    payload: loadFixture("commercial-runtime.json"),
    token: TOKEN,
    operatorWrites: options.operatorWrites ?? true,
    ...(options.operatorWriteStatus === undefined
      ? {}
      : { operatorWriteStatus: options.operatorWriteStatus }),
  });
  const fetchHits: Array<{ method: string; url: string }> = [];
  const client = new WarmblyOperatorClient({
    baseUrl: stub.url,
    token: TOKEN,
    timeoutMs: 2_000,
    logger: () => undefined,
    ...(options.breaker ? { breaker: options.breaker } : {}),
    fetchImpl: async (input, init) => {
      fetchHits.push({ method: init?.method ?? "GET", url: String(input) });
      return fetch(input, init);
    },
  });
  const memory = createMemoryOperatorActionLedger();
  const ledger = options.sink
    ? createFanOutOperatorActionLedger(memory, [options.sink])
    : memory;
  const channel = createWarmblyOperatorChannel({
    client,
    ledger,
    identityPolicy: defaultOperatorIdentityPolicy(),
    logger: () => undefined,
    ...(options.confirmationTtlMs === undefined
      ? {}
      : { confirmationTtlMs: options.confirmationTtlMs }),
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    channel,
    ledger: memory,
    stub,
    fetchHits,
    close: () => stub.close(),
  };
}

function onlyEntry(entries: OperatorActionLedgerEntry[]): OperatorActionLedgerEntry {
  assert.equal(entries.length, 1, `expected exactly one ledger entry, got ${entries.length}`);
  return entries[0]!;
}

describe("operator action allowlist", () => {
  it("names exactly three actions and no send/dispatch/enroll/financial verb", () => {
    assert.deepEqual([...OPERATOR_ACTION_NAMES], [
      "pause_dispatch",
      "resume_dispatch",
      "acknowledge_inbound_alert",
    ]);
    for (const forbidden of OPERATOR_FORBIDDEN_ACTIONS) {
      assert.equal(resolveOperatorAction(forbidden), undefined, forbidden);
    }
    assert.equal(OPERATOR_ACTIONS.pause_dispatch.confirmation, "none");
    assert.equal(OPERATOR_ACTIONS.resume_dispatch.confirmation, "two_step");
    assert.equal(OPERATOR_ACTIONS.acknowledge_inbound_alert.confirmation, "none");
  });

  it("allows POST on exactly the three operational controls", () => {
    assert.equal(classifyOperatorRequest("POST", "/v1/confenge/dispatch/pause").allowed, true);
    assert.equal(classifyOperatorRequest("POST", "/v1/confenge/dispatch/resume").allowed, true);
    assert.equal(
      classifyOperatorRequest("POST", "/v1/confenge/inbound/lead-42/acknowledge").allowed,
      true,
    );
  });

  it("denies every other method and every other path", () => {
    for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      assert.equal(
        classifyOperatorRequest(method, "/v1/confenge/dispatch/pause").allowed,
        false,
        method,
      );
    }
    const forbiddenPaths = [
      "/v1/confenge/dispatch/now",
      "/v1/confenge/cohorts/abc/dispatch",
      "/v1/confenge/import",
      "/v1/confenge/crm/bootstrap",
      "/v1/confenge/inbound/lead-42/outcome",
      "/v1/confenge/inbound/lead-42/resolve",
      "/v1/confenge/drafts/1/send",
      "/v1/campaigns/abc/start",
      "/v1/campaigns/abc/stop",
      "/v1/unibox/reply",
      "/v1/crm/deals",
      "/v1/contacts",
      "/v1/confenge/inbound/../../campaigns/abc/start/acknowledge",
      "/v1/confenge/inbound/%2e%2e%2fstart/acknowledge",
      "/v1/confenge/inbound//acknowledge",
      "/v1/confenge/inbound/lead-42/acknowledge/extra",
    ];
    for (const path of forbiddenPaths) {
      assert.equal(classifyOperatorRequest("POST", path).allowed, false, path);
    }
  });

  it("leaves the read allowlist read-only: the operator paths stay denied there", () => {
    assert.equal(classifyRequest("POST", "/v1/confenge/dispatch/pause").allowed, false);
    assert.equal(classifyRequest("POST", "/v1/confenge/dispatch/resume").allowed, false);
    assert.equal(
      classifyRequest("POST", "/v1/confenge/inbound/lead-42/acknowledge").allowed,
      false,
    );
  });

  it("refuses an unknown action name and records the refusal", async () => {
    const h = await harness();
    try {
      const result = await h.channel.execute({
        action: "send_campaign",
        request: founderRequest(),
        reason: "operator asked",
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "unknown_action");
      const entry = onlyEntry(h.ledger.list());
      assert.equal(entry.outcome, "refused");
      assert.equal(entry.requested_action, "send_campaign");
      assert.equal(entry.action, null);
      assert.equal(entry.actor?.id, "founder");
      assert.equal(h.fetchHits.length, 0);
      assert.equal(h.stub.operatorCalls.length, 0);
    } finally {
      await h.close();
    }
  });
});

describe("operator identity", () => {
  it("refuses when no Remote-* identity is present", async () => {
    const h = await harness();
    try {
      const result = await h.channel.pauseDispatch({
        request: { remoteAddress: TRUSTED_HOP, headers: {} },
        reason: "kill switch drill",
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "missing_actor");
      const entry = onlyEntry(h.ledger.list());
      assert.equal(entry.outcome, "refused");
      assert.equal(entry.refusal_code, "missing_actor");
      assert.equal(entry.actor, null);
      assert.equal(h.fetchHits.length, 0);
    } finally {
      await h.close();
    }
  });

  it("refuses Remote-* headers presented from an untrusted hop (spoofed identity)", async () => {
    const h = await harness();
    try {
      const result = await h.channel.pauseDispatch({
        request: { remoteAddress: "203.0.113.9", headers: AUTHELIA_HEADERS },
        reason: "kill switch drill",
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "missing_actor");
      assert.match(result.reason, /spoofed_identity/);
      assert.equal(h.fetchHits.length, 0);
    } finally {
      await h.close();
    }
  });

  it("refuses a founder without the required operator group", async () => {
    const h = await harness();
    try {
      const result = await h.channel.pauseDispatch({
        request: founderRequest({ ...AUTHELIA_HEADERS, "Remote-Groups": "guests" }),
        reason: "kill switch drill",
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "missing_actor");
      assert.equal(onlyEntry(h.ledger.list()).actor, null);
      assert.equal(h.fetchHits.length, 0);
    } finally {
      await h.close();
    }
  });

  it("derives the actor from Remote-User and never from Remote-Email", async () => {
    const h = await harness();
    try {
      const result = await h.channel.pauseDispatch({
        request: founderRequest(),
        reason: "kill switch drill",
      });
      assert.equal(result.ok, true);
      const entry = onlyEntry(h.ledger.list());
      assert.equal(entry.actor?.kind, "founder");
      assert.equal(entry.actor?.id, "founder");
      assert.equal(entry.actor?.display_name, "Founder Confenge");
      assert.equal(JSON.stringify(entry).includes("founder@confenge.invalid"), false);
    } finally {
      await h.close();
    }
  });
});

describe("pause dispatch (one step, always offered)", () => {
  it("engages the kill switch in one call and records the upstream status", async () => {
    const h = await harness();
    try {
      const result = await h.channel.pauseDispatch({
        request: founderRequest(),
        reason: "spike de bounce",
      });
      assert.equal(result.ok, true);
      if (!result.ok || result.outcome !== "executed") return;
      assert.equal(result.action, "pause_dispatch");
      assert.equal(result.upstream_status, 200);
      assert.equal(h.stub.operatorCalls.length, 1);
      assert.equal(h.stub.operatorCalls[0]!.path, "/v1/confenge/dispatch/pause");
      assert.equal(h.stub.operatorCalls[0]!.method, "POST");
      assert.deepEqual(JSON.parse(h.stub.operatorCalls[0]!.body), { reason: "spike de bounce" });

      const entry = onlyEntry(h.ledger.list());
      assert.equal(entry.outcome, "executed");
      assert.equal(entry.action, "pause_dispatch");
      assert.equal(entry.target.kind, "dispatch");
      assert.equal(entry.target.id, DISPATCH_TARGET_ID);
      assert.equal(entry.upstream.method, "POST");
      assert.equal(entry.upstream.path, "/v1/confenge/dispatch/pause");
      assert.equal(entry.upstream.status, 200);
      assert.equal(entry.confirmation.required, false);
      assert.match(entry.recorded_at, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    } finally {
      await h.close();
    }
  });

  it("never accepts a confirmation-token flow for pause", async () => {
    const h = await harness();
    try {
      const result = await h.channel.requestResumeConfirmation({
        request: founderRequest(),
        reason: "x",
      });
      assert.equal(result.ok, true);
      const notApplicable = await h.channel.requestConfirmation({
        action: "pause_dispatch",
        request: founderRequest(),
        reason: "spike de bounce",
      });
      assert.equal(notApplicable.ok, false);
      if (notApplicable.ok) return;
      assert.equal(notApplicable.code, "confirmation_not_applicable");
    } finally {
      await h.close();
    }
  });

  it("refuses a pause without an audit reason", async () => {
    const h = await harness();
    try {
      const result = await h.channel.pauseDispatch({ request: founderRequest() });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "invalid_reason");
      assert.equal(h.stub.operatorCalls.length, 0);
    } finally {
      await h.close();
    }
  });
});

describe("resume dispatch (two step)", () => {
  it("refuses a one-step resume and records confirmation_required", async () => {
    const h = await harness();
    try {
      const result = await h.channel.resumeDispatch({
        request: founderRequest(),
        reason: "incidente resolvido",
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "confirmation_required");
      const entry = onlyEntry(h.ledger.list());
      assert.equal(entry.outcome, "refused");
      assert.equal(entry.confirmation.required, true);
      assert.equal(entry.confirmation.satisfied, false);
      assert.equal(h.stub.operatorCalls.length, 0);
      assert.equal(h.fetchHits.length, 0);
    } finally {
      await h.close();
    }
  });

  it("executes only after an explicit confirmation token is replayed", async () => {
    const h = await harness();
    try {
      const step1 = await h.channel.requestResumeConfirmation({
        request: founderRequest(),
        reason: "incidente resolvido",
      });
      assert.equal(step1.ok, true);
      if (!step1.ok || step1.outcome !== "challenged") return;
      assert.equal(h.stub.operatorCalls.length, 0, "step 1 must not call Warmbly");

      const step2 = await h.channel.resumeDispatch({
        request: founderRequest(),
        reason: "incidente resolvido",
        confirmation_token: step1.challenge.token,
      });
      assert.equal(step2.ok, true);
      if (!step2.ok || step2.outcome !== "executed") return;
      assert.equal(step2.upstream_status, 200);
      assert.equal(h.stub.operatorCalls.length, 1);
      assert.equal(h.stub.operatorCalls[0]!.path, "/v1/confenge/dispatch/resume");

      const entries = h.ledger.list();
      assert.equal(entries.length, 2);
      assert.equal(entries[0]!.outcome, "challenged");
      assert.equal(entries[1]!.outcome, "executed");
      assert.equal(entries[1]!.confirmation.satisfied, true);
      assert.equal(entries[1]!.confirmation.token_id, step1.challenge.token_id);
    } finally {
      await h.close();
    }
  });

  it("refuses a forged, reused, or expired confirmation token", async () => {
    let clock = new Date("2026-08-22T10:00:00.000Z");
    const h = await harness({ confirmationTtlMs: 60_000, now: () => clock });
    try {
      const forged = await h.channel.resumeDispatch({
        request: founderRequest(),
        reason: "incidente resolvido",
        confirmation_token: "wcnf_not-a-real-token",
      });
      assert.equal(forged.ok, false);
      if (!forged.ok) assert.equal(forged.code, "confirmation_invalid");

      const challenge = await h.channel.requestResumeConfirmation({
        request: founderRequest(),
        reason: "incidente resolvido",
      });
      assert.equal(challenge.ok, true);
      if (!challenge.ok || challenge.outcome !== "challenged") return;
      const token = challenge.challenge.token;

      const first = await h.channel.resumeDispatch({
        request: founderRequest(),
        reason: "incidente resolvido",
        confirmation_token: token,
      });
      assert.equal(first.ok, true);
      const replay = await h.channel.resumeDispatch({
        request: founderRequest(),
        reason: "incidente resolvido",
        confirmation_token: token,
      });
      assert.equal(replay.ok, false);
      if (!replay.ok) assert.equal(replay.code, "confirmation_invalid");

      const second = await h.channel.requestResumeConfirmation({
        request: founderRequest(),
        reason: "incidente resolvido",
      });
      assert.equal(second.ok, true);
      if (!second.ok || second.outcome !== "challenged") return;
      clock = new Date("2026-08-22T10:05:00.000Z");
      const expired = await h.channel.resumeDispatch({
        request: founderRequest(),
        reason: "incidente resolvido",
        confirmation_token: second.challenge.token,
      });
      assert.equal(expired.ok, false);
      if (!expired.ok) assert.equal(expired.code, "confirmation_invalid");

      assert.equal(h.stub.operatorCalls.length, 1, "only the confirmed resume reached Warmbly");
    } finally {
      await h.close();
    }
  });

  it("refuses a confirmation token minted for a different operator", async () => {
    const h = await harness();
    try {
      const challenge = await h.channel.requestResumeConfirmation({
        request: founderRequest(),
        reason: "incidente resolvido",
      });
      assert.equal(challenge.ok, true);
      if (!challenge.ok || challenge.outcome !== "challenged") return;
      const other = await h.channel.resumeDispatch({
        request: founderRequest({ ...AUTHELIA_HEADERS, "Remote-User": "otheroperator" }),
        reason: "incidente resolvido",
        confirmation_token: challenge.challenge.token,
      });
      assert.equal(other.ok, false);
      if (!other.ok) assert.equal(other.code, "confirmation_invalid");
      assert.equal(h.stub.operatorCalls.length, 0);
    } finally {
      await h.close();
    }
  });
});

describe("acknowledge inbound alert", () => {
  it("acknowledges one lead by id and never widens the path", async () => {
    const h = await harness();
    try {
      const ok = await h.channel.acknowledgeInboundAlert({
        request: founderRequest(),
        target_id: "lead-2f7c",
      });
      assert.equal(ok.ok, true);
      if (!ok.ok || ok.outcome !== "executed") return;
      assert.equal(h.stub.operatorCalls[0]!.path, "/v1/confenge/inbound/lead-2f7c/acknowledge");
      assert.equal(ok.entry.target.kind, "inbound_alert");
      assert.equal(ok.entry.target.id, "lead-2f7c");
    } finally {
      await h.close();
    }
  });

  it("refuses traversal, separators, and route-smuggling target ids before any socket opens", async () => {
    const h = await harness();
    try {
      const evil = [
        "../../campaigns/abc/start",
        "lead/../../dispatch/now",
        "lead%2f..%2fstart",
        "lead-42/acknowledge/../../import",
        "lead 42",
        "",
      ];
      for (const target_id of evil) {
        const result = await h.channel.acknowledgeInboundAlert({
          request: founderRequest(),
          target_id,
        });
        assert.equal(result.ok, false, target_id);
        if (result.ok) continue;
        assert.equal(result.code, "invalid_target", target_id);
      }
      assert.equal(h.fetchHits.length, 0);
      assert.equal(h.stub.operatorCalls.length, 0);
      assert.equal(h.ledger.list().length, evil.length);
      for (const entry of h.ledger.list()) {
        assert.equal(entry.outcome, "refused");
        assert.equal(entry.refusal_code, "invalid_target");
      }
    } finally {
      await h.close();
    }
  });

  it("refuses a non-singleton target on the dispatch kill switch", async () => {
    const h = await harness();
    try {
      const result = await h.channel.execute({
        action: "pause_dispatch",
        request: founderRequest(),
        target_id: "some-other-org",
        reason: "spike de bounce",
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "invalid_target");
      assert.equal(h.stub.operatorCalls.length, 0);
    } finally {
      await h.close();
    }
  });
});

describe("fail-closed upstream and breaker", () => {
  it("records a refusal on a non-2xx upstream instead of reporting success", async () => {
    const h = await harness({ operatorWriteStatus: 403 });
    try {
      const result = await h.channel.pauseDispatch({
        request: founderRequest(),
        reason: "spike de bounce",
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "upstream_error");
      const entry = onlyEntry(h.ledger.list());
      assert.equal(entry.outcome, "refused");
      assert.equal(entry.upstream.status, 403);
      assert.equal(entry.upstream.path, "/v1/confenge/dispatch/pause");
    } finally {
      await h.close();
    }
  });

  it("refuses without calling Warmbly when the connector circuit breaker is open", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetMs: 60_000 });
    breaker.recordFailure();
    assert.equal(breaker.getState(), "open");
    const h = await harness({ breaker });
    try {
      const result = await h.channel.pauseDispatch({
        request: founderRequest(),
        reason: "spike de bounce",
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "circuit_open");
      assert.match(result.reason, /pause\.sh/);
      const entry = onlyEntry(h.ledger.list());
      assert.equal(entry.circuit_state, "open");
      assert.equal(entry.upstream.status, null);
      assert.equal(h.fetchHits.length, 0);
      assert.equal(h.stub.operatorCalls.length, 0);
    } finally {
      await h.close();
    }
  });

  it("shares the read client breaker so a degraded Warmbly blocks operator writes too", async () => {
    const read = new WarmblyClient({
      baseUrl: "http://127.0.0.1:1",
      token: TOKEN,
      failureThreshold: 1,
      logger: () => undefined,
    });
    read.breaker.recordFailure();
    const h = await harness({ breaker: read.breaker });
    try {
      const result = await h.channel.pauseDispatch({
        request: founderRequest(),
        reason: "spike de bounce",
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "circuit_open");
    } finally {
      await h.close();
    }
  });

  it("records a transport refusal when Warmbly is unreachable", async () => {
    const client = new WarmblyOperatorClient({
      baseUrl: "http://127.0.0.1:1",
      token: TOKEN,
      timeoutMs: 500,
      logger: () => undefined,
    });
    const ledger = createMemoryOperatorActionLedger();
    const channel = createWarmblyOperatorChannel({ client, ledger, logger: () => undefined });
    const result = await channel.pauseDispatch({
      request: founderRequest(),
      reason: "spike de bounce",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "transport_error");
    const entry = onlyEntry(ledger.list());
    assert.equal(entry.outcome, "refused");
    assert.equal(entry.upstream.status, null);
  });

  it("does not leak the Warmbly token in operator logs", async () => {
    const stub = await startFixtureStub({
      payload: loadFixture("commercial-runtime.json"),
      token: TOKEN,
      operatorWrites: true,
    });
    const logger = capturingLogger();
    try {
      const client = new WarmblyOperatorClient({
        baseUrl: stub.url,
        token: TOKEN,
        logger: logger.logger,
      });
      const channel = createWarmblyOperatorChannel({ client, logger: logger.logger });
      await channel.pauseDispatch({ request: founderRequest(), reason: "spike de bounce" });
      const blob = `${logger.blob()}\n${JSON.stringify(client.describeAuthForLogs())}`;
      assert.equal(blob.includes(TOKEN), false);
    } finally {
      await stub.close();
    }
  });
});

describe("no forbidden method or path is reachable through the channel", () => {
  it("only ever issues POST to the three allowed paths, whatever the caller asks", async () => {
    const h = await harness();
    try {
      const attempts = [
        { action: "send", target_id: "lead-1" },
        { action: "dispatch_now", target_id: DISPATCH_TARGET_ID },
        { action: "enroll", target_id: "lead-1" },
        { action: "approve_content", target_id: "draft-1" },
        { action: "campaign_start", target_id: "camp-1" },
        { action: "charge", target_id: "cust-1" },
        { action: "refund", target_id: "pay-1" },
        { action: "POST /v1/confenge/import", target_id: "x" },
        { action: "DELETE /v1/crm/tasks/1", target_id: "x" },
        { action: "acknowledge_inbound_alert/../../import", target_id: "x" },
      ];
      for (const attempt of attempts) {
        const result = await h.channel.execute({
          ...attempt,
          request: founderRequest(),
          reason: "tentativa",
        });
        assert.equal(result.ok, false, attempt.action);
      }
      // Only the legitimate calls below may touch the wire.
      await h.channel.pauseDispatch({ request: founderRequest(), reason: "spike" });
      await h.channel.acknowledgeInboundAlert({ request: founderRequest(), target_id: "lead-9" });

      assert.equal(h.fetchHits.length, 2);
      for (const hit of h.fetchHits) {
        assert.equal(hit.method, "POST");
      }
      const paths = h.stub.operatorCalls.map((c) => c.path);
      assert.deepEqual(paths, [
        "/v1/confenge/dispatch/pause",
        "/v1/confenge/inbound/lead-9/acknowledge",
      ]);
      const everyPath = h.stub.calls.map((c) => `${c.method} ${c.path}`);
      for (const call of everyPath) {
        assert.doesNotMatch(call, /\/(import|bootstrap|start|stop|send|enroll|dispatch\/now)\b/);
        assert.doesNotMatch(call, /^(GET|PUT|PATCH|DELETE|HEAD) /);
        assert.doesNotMatch(call, /asaas|checkout|refund|cobranca/i);
      }
      assert.equal(h.ledger.list().filter((e) => e.outcome === "refused").length, attempts.length);
    } finally {
      await h.close();
    }
  });
});

describe("ledger recording", () => {
  it("writes exactly one entry per call, on success and on refusal alike", async () => {
    const h = await harness();
    try {
      await h.channel.pauseDispatch({ request: founderRequest(), reason: "spike" });
      await h.channel.execute({ action: "nope", request: founderRequest(), reason: "spike" });
      await h.channel.pauseDispatch({ request: { remoteAddress: TRUSTED_HOP, headers: {} }, reason: "spike" });
      const entries = h.ledger.list();
      assert.equal(entries.length, 3);
      assert.deepEqual(
        entries.map((e) => e.outcome),
        ["executed", "refused", "refused"],
      );
      for (const entry of entries) {
        assert.equal(entry.schema_version, "control-center.warmbly-operator-action.v1");
        assert.ok(entry.id.startsWith("cc:warmbly-operator-action:"));
        assert.ok(entry.correlation_id.length > 0);
        assert.equal(entry.source.system, "control-center");
        assert.equal(entry.source.kind, "warmbly-operator-action");
        assert.equal(entry.freshness_status, "FRESH");
        assert.match(entry.recorded_at, /Z$/);
        assert.ok("upstream" in entry && "status" in entry.upstream);
      }
      assert.equal(entries[0]!.upstream.status, 200);
      assert.equal(entries[1]!.upstream.status, null);
      assert.equal(entries[2]!.actor, null);
    } finally {
      await h.close();
    }
  });

  it("lands both the executed action and the refusal in the agent-activity ledger", async () => {
    const agentLedger = createAgentLedger();
    const sink = createAgentActivityLedgerSink(agentLedger);
    const h = await harness({ sink });
    try {
      const executed = await h.channel.pauseDispatch({
        request: founderRequest(),
        reason: "spike de bounce",
      });
      assert.equal(executed.ok, true);
      const refused = await h.channel.resumeDispatch({
        request: founderRequest(),
        reason: "incidente resolvido",
      });
      assert.equal(refused.ok, false);

      const timeline = agentLedger.timeline({
        from: "2000-01-01T00:00:00Z",
        to: "2100-01-01T00:00:00Z",
      });
      assert.equal(timeline.length, 2);
      const statuses = timeline.map((row) => row.status).sort();
      assert.deepEqual(statuses, ["BLOCKED", "DONE"]);
      for (const row of timeline) {
        assert.equal(row.actor.kind, "founder");
        assert.equal(row.actor.id, "founder");
        assert.equal(row.agent.id, "cc-warmbly-operator-channel");
        assert.equal(row.repo, "confenge/warmbly");
        assert.ok(row.goal.startsWith("warmbly operator action "));
        assert.ok(row.evidence.some((line) => line.startsWith("upstream=")));
        assert.ok(row.evidence.some((line) => line.startsWith("circuit=")));
      }
      const done = timeline.find((row) => row.status === "DONE")!;
      assert.ok(done.evidence.includes("upstream=POST /v1/confenge/dispatch/pause 200"));
      const blocked = timeline.find((row) => row.status === "BLOCKED")!;
      assert.ok(blocked.evidence.includes("refusal_code=confirmation_required"));
      assert.equal(blocked.blockers.length, 1);
    } finally {
      await h.close();
    }
  });
});

describe("mountable HTTP surface", () => {
  it("exposes four POST-only routes and refuses anything else", async () => {
    const h = await harness();
    const handle = createOperatorHttpHandler(h.channel);
    try {
      const notFound = await handle({
        method: "POST",
        url: "/v1/warmbly/operator/dispatch/now",
        headers: AUTHELIA_HEADERS,
        remoteAddress: TRUSTED_HOP,
        body: {},
      });
      assert.equal(notFound.status, 404);

      for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
        const wrong = await handle({
          method,
          url: OPERATOR_HTTP_ROUTES.pause,
          headers: AUTHELIA_HEADERS,
          remoteAddress: TRUSTED_HOP,
          body: {},
        });
        assert.equal(wrong.status, 405, method);
      }
      assert.equal(h.stub.operatorCalls.length, 0);
      assert.equal(h.ledger.list().length, 0);
    } finally {
      await h.close();
    }
  });

  it("takes identity from Remote-* headers only and 401s without them", async () => {
    const h = await harness();
    const handle = createOperatorHttpHandler(h.channel);
    try {
      const anonymous = await handle({
        method: "POST",
        url: OPERATOR_HTTP_ROUTES.pause,
        headers: { "x-actor-id": "founder", "x-actor-kind": "human" },
        remoteAddress: TRUSTED_HOP,
        body: { reason: "spike" },
      });
      assert.equal(anonymous.status, 401);
      assert.equal(anonymous.body.ok, false);
      assert.equal(anonymous.body.code, "missing_actor");
      assert.equal(onlyEntry(h.ledger.list()).actor, null);
      assert.equal(h.stub.operatorCalls.length, 0);
    } finally {
      await h.close();
    }
  });

  it("runs the two-step resume over HTTP: 428 without a token, 202 challenge, 200 confirmed", async () => {
    const h = await harness();
    const handle = createOperatorHttpHandler(h.channel);
    const req = (url: string, body: unknown) => ({
      method: "POST",
      url,
      headers: AUTHELIA_HEADERS,
      remoteAddress: TRUSTED_HOP,
      body,
    });
    try {
      const oneStep = await handle(req(OPERATOR_HTTP_ROUTES.resume, { reason: "incidente resolvido" }));
      assert.equal(oneStep.status, 428);

      const challenge = await handle(
        req(OPERATOR_HTTP_ROUTES.resumeConfirm, { reason: "incidente resolvido" }),
      );
      assert.equal(challenge.status, 202);
      const token = challenge.body.confirmation_token as string;
      assert.ok(token.length > 0);

      const confirmed = await handle(
        req(OPERATOR_HTTP_ROUTES.resume, {
          reason: "incidente resolvido",
          confirmation_token: token,
        }),
      );
      assert.equal(confirmed.status, 200);
      assert.equal(confirmed.body.upstream_status, 200);
      assert.equal(h.stub.operatorCalls.length, 1);
      assert.equal(h.stub.operatorCalls[0]!.path, "/v1/confenge/dispatch/resume");
    } finally {
      await h.close();
    }
  });

  it("pauses in one HTTP call and returns 502 when Warmbly refuses", async () => {
    const ok = await harness();
    try {
      const handle = createOperatorHttpHandler(ok.channel);
      const res = await handle({
        method: "POST",
        url: OPERATOR_HTTP_ROUTES.pause,
        headers: AUTHELIA_HEADERS,
        remoteAddress: TRUSTED_HOP,
        body: { reason: "spike de bounce" },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.action, "pause_dispatch");
      assert.ok(String(res.body.ledger_id).startsWith("cc:warmbly-operator-action:"));
    } finally {
      await ok.close();
    }

    const bad = await harness({ operatorWriteStatus: 500 });
    try {
      const handle = createOperatorHttpHandler(bad.channel);
      const res = await handle({
        method: "POST",
        url: OPERATOR_HTTP_ROUTES.pause,
        headers: AUTHELIA_HEADERS,
        remoteAddress: TRUSTED_HOP,
        body: { reason: "spike de bounce" },
      });
      assert.equal(res.status, 502);
      assert.equal(res.body.ok, false);
      assert.equal(onlyEntry(bad.ledger.list()).upstream.status, 500);
    } finally {
      await bad.close();
    }
  });
});
