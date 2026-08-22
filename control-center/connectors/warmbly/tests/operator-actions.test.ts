import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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
  OPERATOR_LEDGER_ROUTE,
  createWarmblyOperatorChannel,
  defaultOperatorIdentityPolicy,
  defaultOperatorSinkErrorHandler,
  OPERATOR_HTTP_ROUTES,
  OPERATOR_LEDGER_WAL_MARKER,
  operatorLedgerWalLine,
  resolveOperatorAction,
  type OperatorActionLedger,
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
  sinkErrors: Array<{ err: unknown; entry: OperatorActionLedgerEntry }>;
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
    onSinkError?: (err: unknown, entry: OperatorActionLedgerEntry) => void;
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
  const sinkErrors: Array<{ err: unknown; entry: OperatorActionLedgerEntry }> = [];
  const onSinkError =
    options.onSinkError ??
    ((err: unknown, entry: OperatorActionLedgerEntry) => {
      sinkErrors.push({ err, entry });
    });
  const ledger = options.sink
    ? createFanOutOperatorActionLedger(memory, [options.sink], onSinkError)
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
    sinkErrors,
    close: () => stub.close(),
  };
}

type UpstreamCall = { method: string; path: string; auth: string; body: string };

type ScriptedUpstream = {
  url: string;
  calls: UpstreamCall[];
  close: () => Promise<void>;
};

/**
 * A Warmbly stand-in that records what actually arrived on the wire — headers
 * and body included — so a test can prove whether a second, unclassified hop
 * was ever issued and whether the Bearer token travelled with it.
 */
async function startScriptedUpstream(
  respond: (call: UpstreamCall, res: ServerResponse, index: number) => void,
): Promise<ScriptedUpstream> {
  const calls: UpstreamCall[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const call: UpstreamCall = {
        method: (req.method ?? "GET").toUpperCase(),
        path: (req.url ?? "/").split("?")[0] ?? "/",
        auth: String(req.headers.authorization ?? ""),
        body: Buffer.concat(chunks).toString("utf8"),
      };
      calls.push(call);
      respond(call, res, calls.length - 1);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("scripted upstream failed to bind");
  }
  return {
    url: `http://127.0.0.1:${addr.port}`,
    calls,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function operatorChannelAgainst(
  baseUrl: string,
  options: { timeoutMs?: number; ledger?: OperatorActionLedger } = {},
): { channel: WarmblyOperatorChannel; ledger: OperatorActionLedger } {
  const client = new WarmblyOperatorClient({
    baseUrl,
    token: TOKEN,
    timeoutMs: options.timeoutMs ?? 2_000,
    logger: () => undefined,
  });
  const ledger = options.ledger ?? createMemoryOperatorActionLedger();
  const channel = createWarmblyOperatorChannel({ client, ledger, logger: () => undefined });
  return { channel, ledger };
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

describe("operator ledger read-back", () => {
  it("is gated by the same founder identity as a write, and never leaks a token", async () => {
    const h = await harness();
    const handle = createOperatorHttpHandler(h.channel);
    try {
      // An unauthenticated read is refused before it can disclose who acted.
      const anon = await handle({
        method: "GET",
        url: OPERATOR_LEDGER_ROUTE,
        headers: {},
        remoteAddress: TRUSTED_HOP,
        body: undefined,
      });
      assert.equal(anon.status, 401);
      assert.equal((anon.body as { entries?: unknown }).entries, undefined);

      // A spoofed hop is refused too: Authelia headers only count from a
      // trusted reverse-proxy hop.
      const spoofed = await handle({
        method: "GET",
        url: OPERATOR_LEDGER_ROUTE,
        headers: AUTHELIA_HEADERS,
        remoteAddress: "203.0.113.9",
        body: undefined,
      });
      assert.equal(spoofed.status, 401);

      await h.channel.pauseDispatch({ request: founderRequest(), reason: "pico de bounce" });
      const read = await handle({
        method: "GET",
        url: OPERATOR_LEDGER_ROUTE,
        headers: AUTHELIA_HEADERS,
        remoteAddress: TRUSTED_HOP,
        body: undefined,
      });
      assert.equal(read.status, 200);
      const entries = (read.body as { entries: Array<Record<string, unknown>> }).entries;
      assert.equal(entries.length, 1);
      assert.equal(entries[0]!.action, "pause_dispatch");
      assert.equal(entries[0]!.outcome, "executed");
      assert.equal(entries[0]!.actor_id, "founder");
      assert.equal(entries[0]!.reason, "pico de bounce");
      // The projection carries no token and no raw header material.
      const serialized = JSON.stringify(read.body);
      assert.ok(!serialized.includes(TOKEN), "the Warmbly bearer token must never appear");
      assert.ok(!serialized.includes("wcnf_"), "a confirmation token must never appear");
      assert.ok(!serialized.includes("founder@confenge.invalid"), "Remote-Email must never appear");
    } finally {
      await h.close();
    }
  });

  it("is read-only: a write verb on the ledger route is refused", async () => {
    const h = await harness();
    const handle = createOperatorHttpHandler(h.channel);
    try {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const wrong = await handle({
          method,
          url: OPERATOR_LEDGER_ROUTE,
          headers: AUTHELIA_HEADERS,
          remoteAddress: TRUSTED_HOP,
          body: {},
        });
        assert.equal(wrong.status, 405, method);
      }
      assert.equal(h.stub.operatorCalls.length, 0);
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

describe("unknown outcome: the request was written and the answer never came", () => {
  it("records unknown, never refused, when Warmbly answers slower than the timeout", async () => {
    const upstream = await startScriptedUpstream((_call, res) => {
      setTimeout(() => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ data: { resumed: true } }));
      }, 500);
    });
    try {
      const { channel, ledger } = operatorChannelAgainst(upstream.url, { timeoutMs: 120 });
      const handle = createOperatorHttpHandler(channel);
      const challenge = await handle({
        method: "POST",
        url: OPERATOR_HTTP_ROUTES.resumeConfirm,
        headers: AUTHELIA_HEADERS,
        remoteAddress: TRUSTED_HOP,
        body: { reason: "incidente resolvido" },
      });
      assert.equal(challenge.status, 202);
      const token = challenge.body.confirmation_token as string;

      const resumed = await handle({
        method: "POST",
        url: OPERATOR_HTTP_ROUTES.resume,
        headers: AUTHELIA_HEADERS,
        remoteAddress: TRUSTED_HOP,
        body: { reason: "incidente resolvido", confirmation_token: token },
      });

      // The POST reached Warmbly: it may well have resumed dispatch.
      assert.equal(upstream.calls.length, 1);
      assert.equal(upstream.calls[0]!.path, "/v1/confenge/dispatch/resume");

      assert.equal(resumed.status, 503);
      assert.equal(resumed.body.ok, false);
      assert.equal(resumed.body.outcome, "unknown");
      assert.equal(resumed.body.code, "transport_unknown");
      assert.match(String(resumed.body.reason), /GET \/v1\/confenge\/dispatch\/status/);

      const entries = ledger.list();
      assert.deepEqual(
        entries.map((e) => e.outcome),
        ["challenged", "unknown"],
      );
      const unknown = entries[1]!;
      assert.notEqual(unknown.outcome, "refused");
      assert.equal(unknown.refusal_code, "transport_unknown");
      assert.equal(unknown.action, "resume_dispatch");
      assert.equal(unknown.upstream.method, "POST");
      assert.equal(unknown.upstream.path, "/v1/confenge/dispatch/resume");
      assert.equal(unknown.upstream.status, null);
      assert.equal(unknown.confirmation.satisfied, true);
      assert.ok(String(unknown.confirmation.token_id).startsWith("cnf:resume_dispatch:"));
    } finally {
      await upstream.close();
    }
  });

  it("keeps a spent confirmation token spent after an unknown outcome", async () => {
    // Decision: the burned token stays burned. Re-arming it would turn one
    // observed token into a replayable resume; the operator reads dispatch
    // status and, if still paused, mints a fresh confirmation.
    const upstream = await startScriptedUpstream((_call, res) => {
      setTimeout(() => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ data: { resumed: true } }));
      }, 500);
    });
    try {
      const { channel, ledger } = operatorChannelAgainst(upstream.url, { timeoutMs: 120 });
      const step1 = await channel.requestResumeConfirmation({
        request: founderRequest(),
        reason: "incidente resolvido",
      });
      if (!step1.ok || step1.outcome !== "challenged") {
        throw new Error("expected a challenge");
      }
      const unknown = await channel.resumeDispatch({
        request: founderRequest(),
        reason: "incidente resolvido",
        confirmation_token: step1.challenge.token,
      });
      assert.equal(unknown.ok, false);
      if (unknown.ok) return;
      assert.equal(unknown.outcome, "unknown");
      assert.match(unknown.reason, /fresh confirmation/);

      const retry = await channel.resumeDispatch({
        request: founderRequest(),
        reason: "incidente resolvido",
        confirmation_token: step1.challenge.token,
      });
      assert.equal(retry.ok, false);
      if (retry.ok) return;
      assert.equal(retry.outcome, "refused");
      assert.equal(retry.code, "confirmation_invalid");
      assert.equal(upstream.calls.length, 1, "the retry must not re-POST the resume");
      assert.deepEqual(
        ledger.list().map((e) => e.outcome),
        ["challenged", "unknown", "refused"],
      );
    } finally {
      await upstream.close();
    }
  });

  it("still refuses — nothing was written — when the connection itself never opens", async () => {
    const { channel, ledger } = operatorChannelAgainst("http://127.0.0.1:1", { timeoutMs: 500 });
    const result = await channel.pauseDispatch({
      request: founderRequest(),
      reason: "spike de bounce",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.outcome, "refused");
    assert.equal(result.code, "transport_error");
    const entry = onlyEntry(ledger.list());
    assert.equal(entry.outcome, "refused");
    assert.equal(entry.upstream.status, null);
    assert.equal(entry.upstream.path, null);
  });
});

describe("redirects are never followed", () => {
  it("refuses a 3xx instead of re-POSTing the write with the Bearer token at the Location", async () => {
    const upstream = await startScriptedUpstream((_call, res, index) => {
      if (index === 0) {
        res.statusCode = 307;
        res.setHeader("Location", "/v1/confenge/dispatch/dispatch-now");
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: { dispatched: true } }));
    });
    try {
      const { channel, ledger } = operatorChannelAgainst(upstream.url);
      const result = await channel.pauseDispatch({
        request: founderRequest(),
        reason: "spike de bounce",
      });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "upstream_error");
      assert.match(result.reason, /redirect/);

      assert.equal(upstream.calls.length, 1, "the redirect must not be followed");
      assert.equal(upstream.calls[0]!.path, "/v1/confenge/dispatch/pause");
      assert.equal(
        upstream.calls.some((call) => call.path.includes("dispatch-now")),
        false,
      );
      for (const call of upstream.calls) {
        assert.equal(classifyOperatorRequest(call.method, call.path).allowed, true, call.path);
      }

      const entry = onlyEntry(ledger.list());
      assert.equal(entry.outcome, "refused");
      assert.equal(entry.upstream.path, "/v1/confenge/dispatch/pause");
      assert.equal(entry.upstream.status, 307);
    } finally {
      await upstream.close();
    }
  });
});

describe("the ledger key is minted here, never by the caller", () => {
  it("keeps an executed entry when a client_reference is replayed by a later refusal", async () => {
    const agentLedger = createAgentLedger();
    const sink = createAgentActivityLedgerSink(agentLedger);
    const h = await harness({ sink });
    const handle = createOperatorHttpHandler(h.channel);
    const CLIENT_REF = "cc.op.2026-08-22";
    try {
      const executed = await handle({
        method: "POST",
        url: OPERATOR_HTTP_ROUTES.pause,
        headers: AUTHELIA_HEADERS,
        remoteAddress: TRUSTED_HOP,
        body: { reason: "spike de bounce", correlation_id: CLIENT_REF },
      });
      assert.equal(executed.status, 200);
      assert.equal(executed.body.client_reference, CLIENT_REF);
      assert.notEqual(executed.body.correlation_id, CLIENT_REF);

      const replay = await handle({
        method: "POST",
        url: OPERATOR_HTTP_ROUTES.acknowledge,
        headers: AUTHELIA_HEADERS,
        remoteAddress: TRUSTED_HOP,
        body: { target_id: "lead 42", correlation_id: CLIENT_REF },
      });
      assert.equal(replay.status, 400);

      const entries = h.ledger.list();
      assert.equal(entries.length, 2);
      assert.equal(entries[0]!.outcome, "executed");
      assert.equal(entries[1]!.outcome, "refused");
      assert.notEqual(entries[0]!.id, entries[1]!.id);
      assert.notEqual(entries[0]!.correlation_id, entries[1]!.correlation_id);
      for (const entry of entries) {
        assert.equal(entry.client_reference, CLIENT_REF);
        assert.ok(entry.correlation_id.startsWith("cc:warmbly-op:"));
        assert.equal(entry.correlation_id.includes(CLIENT_REF), false);
        assert.equal(entry.id.includes(CLIENT_REF), false);
      }

      const timeline = agentLedger.timeline({
        from: "2000-01-01T00:00:00Z",
        to: "2100-01-01T00:00:00Z",
      });
      assert.equal(timeline.length, 2, "the replay must not revise the executed row");
      const done = timeline.find((row) => row.status === "DONE");
      assert.ok(done, "the executed resume must still be on the timeline");
      assert.ok(done!.evidence.includes("upstream=POST /v1/confenge/dispatch/pause 200"));
      assert.equal(h.sinkErrors.length, 0);
    } finally {
      await h.close();
    }
  });
});

describe("a ledger failure after the write is never silent", () => {
  it("emits the executed entry to the durable fallback before rethrowing", async () => {
    const stub = await startFixtureStub({
      payload: loadFixture("commercial-runtime.json"),
      token: TOKEN,
      operatorWrites: true,
    });
    const failures: Array<{ entry: OperatorActionLedgerEntry; err: unknown }> = [];
    const exploding: OperatorActionLedger = {
      record() {
        throw new Error("ledger volume is read-only");
      },
      list: () => [],
    };
    try {
      const client = new WarmblyOperatorClient({
        baseUrl: stub.url,
        token: TOKEN,
        timeoutMs: 2_000,
        logger: () => undefined,
      });
      const channel = createWarmblyOperatorChannel({
        client,
        ledger: exploding,
        logger: () => undefined,
        onLedgerWriteFailure: (entry, err) => failures.push({ entry, err }),
      });
      await assert.rejects(
        () => channel.pauseDispatch({ request: founderRequest(), reason: "spike de bounce" }),
        /read-only/,
      );

      assert.equal(stub.operatorCalls.length, 1, "the write did reach Warmbly");
      assert.equal(failures.length, 1);
      const lost = failures[0]!;
      assert.equal(lost.entry.outcome, "executed");
      assert.equal(lost.entry.action, "pause_dispatch");
      assert.equal(lost.entry.upstream.status, 200);

      const line = operatorLedgerWalLine(lost.entry, lost.err);
      assert.ok(line.endsWith("\n"));
      const parsed = JSON.parse(line) as { wal: string; error: string; entry: { outcome: string } };
      assert.equal(parsed.wal, OPERATOR_LEDGER_WAL_MARKER);
      assert.match(parsed.error, /read-only/);
      assert.equal(parsed.entry.outcome, "executed");
    } finally {
      await stub.close();
    }
  });

  it("fans out to the sinks and rethrows when the primary ledger throws", async () => {
    const h = await harness();
    try {
      await h.channel.pauseDispatch({ request: founderRequest(), reason: "spike de bounce" });
      const entry = onlyEntry(h.ledger.list());

      const mirrored: OperatorActionLedgerEntry[] = [];
      const seen: unknown[] = [];
      const fanned = createFanOutOperatorActionLedger(
        {
          record() {
            throw new Error("primary ledger is down");
          },
          list: () => [],
        },
        [
          {
            record(e) {
              mirrored.push(e);
            },
            list: () => [],
          },
        ],
        (err) => seen.push(err),
      );
      assert.throws(() => fanned.record(entry), /primary ledger is down/);
      assert.equal(mirrored.length, 1, "the mirror still gets the entry");
      assert.equal(seen.length, 1);
    } finally {
      await h.close();
    }
  });
});

describe("agent-activity mirror failures are loud", () => {
  it("reports a rejected timeline row through the required onSinkError handler", async () => {
    // 100 emoji: 100 code points passes the security NAME_RE, 200 UTF-16 units
    // fails agent-activity's display_name max(128).
    const display = "\u{1F642}".repeat(100);
    const agentLedger = createAgentLedger();
    const sink = createAgentActivityLedgerSink(agentLedger);
    const logger = capturingLogger();
    const h = await harness({ sink, onSinkError: defaultOperatorSinkErrorHandler(logger.logger) });
    try {
      const result = await h.channel.pauseDispatch({
        request: founderRequest({ ...AUTHELIA_HEADERS, "Remote-Name": display }),
        reason: "spike de bounce",
      });
      assert.equal(result.ok, true);
      const entry = onlyEntry(h.ledger.list());
      assert.equal(entry.outcome, "executed");
      assert.equal(
        agentLedger.timeline({ from: "2000-01-01T00:00:00Z", to: "2100-01-01T00:00:00Z" }).length,
        0,
        "reproduces the invisible row",
      );

      const errors = logger.entries.filter(
        (line) => line.level === "error" && line.msg === "warmbly.operator.ledger_sink_failed",
      );
      assert.equal(errors.length, 1);
      const serialized = String(errors[0]!.entry);
      assert.ok(serialized.includes(entry.correlation_id));
      assert.ok(serialized.includes('"outcome":"executed"'));
      assert.ok(serialized.includes('"status":200'));
    } finally {
      await h.close();
    }
  });
});

describe("duplicated identity headers fail closed", () => {
  it("refuses an array-valued Remote-User instead of trusting the first copy", async () => {
    const h = await harness();
    try {
      const result = await h.channel.pauseDispatch({
        request: {
          remoteAddress: TRUSTED_HOP,
          headers: {
            "remote-user": ["evil", "founder"],
            "remote-name": "Founder Confenge",
            "remote-groups": "operators",
            "remote-email": "founder@confenge.invalid",
          },
        },
        reason: "spike de bounce",
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.code, "missing_actor");
      assert.equal(onlyEntry(h.ledger.list()).actor, null);
      assert.equal(h.fetchHits.length, 0);
      assert.equal(h.stub.operatorCalls.length, 0);
    } finally {
      await h.close();
    }
  });

  it("refuses a duplicated Remote-Groups too, and still accepts a single-valued array", async () => {
    const h = await harness();
    try {
      const duplicated = await h.channel.pauseDispatch({
        request: {
          remoteAddress: TRUSTED_HOP,
          headers: {
            "remote-user": "founder",
            "remote-name": "Founder Confenge",
            "remote-groups": ["guests", "operators"],
            "remote-email": "founder@confenge.invalid",
          },
        },
        reason: "spike de bounce",
      });
      assert.equal(duplicated.ok, false);
      if (!duplicated.ok) assert.equal(duplicated.code, "missing_actor");
      assert.equal(h.stub.operatorCalls.length, 0);

      const single = await h.channel.pauseDispatch({
        request: {
          remoteAddress: TRUSTED_HOP,
          headers: {
            "remote-user": ["founder"],
            "remote-name": ["Founder Confenge"],
            "remote-groups": ["operators"],
            "remote-email": ["founder@confenge.invalid"],
          },
        },
        reason: "spike de bounce",
      });
      assert.equal(single.ok, true);
      assert.equal(h.stub.operatorCalls.length, 1);
    } finally {
      await h.close();
    }
  });
});

describe("confirmation challenges are individually identifiable and reason-bound", () => {
  it("mints a unique token_id per challenge so the ledger shows which one was spent", async () => {
    const h = await harness();
    try {
      const first = await h.channel.requestResumeConfirmation({
        request: founderRequest(),
        reason: "incidente resolvido",
      });
      const second = await h.channel.requestResumeConfirmation({
        request: founderRequest(),
        reason: "incidente resolvido",
      });
      if (!first.ok || first.outcome !== "challenged") throw new Error("expected a challenge");
      if (!second.ok || second.outcome !== "challenged") throw new Error("expected a challenge");

      const prefix = "cnf:resume_dispatch:confenge-dispatch:";
      assert.ok(first.challenge.token_id.startsWith(prefix));
      assert.ok(second.challenge.token_id.startsWith(prefix));
      assert.notEqual(first.challenge.token_id, second.challenge.token_id);

      const executed = await h.channel.resumeDispatch({
        request: founderRequest(),
        reason: "incidente resolvido",
        confirmation_token: second.challenge.token,
      });
      assert.equal(executed.ok, true);

      const entries = h.ledger.list();
      const challenged = entries
        .filter((e) => e.outcome === "challenged")
        .map((e) => e.confirmation.token_id);
      assert.deepEqual(challenged, [first.challenge.token_id, second.challenge.token_id]);
      assert.equal(new Set(challenged).size, 2, "minted-and-abandoned must be countable");
      const spent = entries.find((e) => e.outcome === "executed")!;
      assert.equal(spent.confirmation.token_id, second.challenge.token_id);
      assert.notEqual(spent.confirmation.token_id, first.challenge.token_id);
    } finally {
      await h.close();
    }
  });

  it("refuses a token confirmed under one reason and executed under another", async () => {
    const h = await harness();
    try {
      const challenge = await h.channel.requestResumeConfirmation({
        request: founderRequest(),
        reason: "incidente resolvido",
      });
      if (!challenge.ok || challenge.outcome !== "challenged") throw new Error("expected a challenge");

      const swapped = await h.channel.resumeDispatch({
        request: founderRequest(),
        reason: "teste de rotina",
        confirmation_token: challenge.challenge.token,
      });
      assert.equal(swapped.ok, false);
      if (swapped.ok) return;
      assert.equal(swapped.code, "confirmation_invalid");
      assert.match(swapped.reason, /audit reason/);
      assert.equal(h.stub.operatorCalls.length, 0);
      assert.equal(h.fetchHits.length, 0);

      const matching = await h.channel.resumeDispatch({
        request: founderRequest(),
        reason: "incidente resolvido",
        confirmation_token: challenge.challenge.token,
      });
      assert.equal(matching.ok, true);
      assert.equal(h.stub.operatorCalls.length, 1);
    } finally {
      await h.close();
    }
  });
});
