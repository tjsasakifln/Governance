import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MARKERS } from "../src/fixtures.js";
import {
  PROMPT_NAMES,
  RESOURCE_URIS,
  TOOL_ALIAS_NAMES,
  TOOL_NAMES,
  isCompatibilityAlias,
} from "../src/types.js";
import {
  assertProvenance,
  authMeta,
  boot,
  callTool,
  errorData,
  handshake,
  isRecord,
  rpc,
  TEST_TOKEN,
  toolPayload,
} from "./helpers.js";

describe("MCP protocol", () => {
  it("initialize advertises tools, resources, and prompts capabilities", async () => {
    const { runtime } = boot();
    const init = await handshake(runtime);
    const result = init["result"];
    assert.ok(isRecord(result));
    assert.equal(typeof result["protocolVersion"], "string");
    const capabilities = result["capabilities"];
    assert.ok(isRecord(capabilities));
    assert.ok(isRecord(capabilities["tools"]));
    assert.ok(isRecord(capabilities["resources"]));
    assert.ok(isRecord(capabilities["prompts"]));
    const serverInfo = result["serverInfo"];
    assert.ok(isRecord(serverInfo));
    assert.equal(serverInfo["name"], "confenge-control-center");
  });

  it("lists the eight Confenge tools by exact name", async () => {
    const { runtime } = boot();
    await handshake(runtime);
    const listed = await rpc(runtime, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: { _meta: authMeta(TEST_TOKEN) },
    });
    assert.ok(listed);
    const result = listed["result"];
    assert.ok(isRecord(result));
    const tools = result["tools"];
    assert.ok(Array.isArray(tools));
    const names = tools.map((tool) => {
      assert.ok(isRecord(tool));
      assert.equal(typeof tool["name"], "string");
      return tool["name"] as string;
    });
    assert.deepEqual(names.slice(0, TOOL_NAMES.length), [...TOOL_NAMES]);
    for (const canonical of TOOL_NAMES) {
      assert.ok(names.includes(canonical), `missing canonical ${canonical}`);
    }
    for (const alias of TOOL_ALIAS_NAMES) {
      assert.ok(names.includes(alias), `missing alias ${alias}`);
    }
    assert.equal(names.length, TOOL_NAMES.length + TOOL_ALIAS_NAMES.length);
    for (const tool of tools) {
      assert.ok(isRecord(tool));
      const name = String(tool["name"]);
      if (isCompatibilityAlias(name)) {
        const meta = tool["_meta"];
        assert.ok(isRecord(meta), `${name} must carry compatibility-alias metadata`);
        assert.equal(meta["compatibility_alias"], true);
        assert.equal(typeof meta["canonical_name"], "string");
        assert.ok(String(meta["canonical_name"]).startsWith("confenge."));
      }
    }
    for (const banned of [
      "confenge.create_directive",
      "confenge.charge",
      "confenge.checkout",
      "confenge.refund",
      "confenge.cancel",
      "confenge.asaas",
      "cobranca",
    ]) {
      assert.equal(
        names.some((name) => name.toLowerCase().includes(banned.replace("confenge.", ""))),
        false,
        `must not advertise ${banned}`,
      );
    }
  });

  it("serves preflight resources and prompts", async () => {
    const { runtime } = boot();
    await handshake(runtime);

    const resources = await rpc(runtime, {
      jsonrpc: "2.0",
      id: 3,
      method: "resources/list",
      params: { _meta: authMeta(TEST_TOKEN) },
    });
    assert.ok(resources);
    const resourceResult = resources["result"];
    assert.ok(isRecord(resourceResult));
    const resourceList = resourceResult["resources"];
    assert.ok(Array.isArray(resourceList));
    const uris = resourceList.map((row) => {
      assert.ok(isRecord(row));
      return row["uri"];
    });
    assert.ok(uris.includes(RESOURCE_URIS.checklist));
    assert.ok(uris.includes(RESOURCE_URIS.rules));

    const read = await rpc(runtime, {
      jsonrpc: "2.0",
      id: 4,
      method: "resources/read",
      params: { uri: RESOURCE_URIS.checklist, _meta: authMeta(TEST_TOKEN) },
    });
    assert.ok(read);
    const readResult = read["result"];
    assert.ok(isRecord(readResult));
    const contents = readResult["contents"];
    assert.ok(Array.isArray(contents));
    const doc = contents[0];
    assert.ok(isRecord(doc));
    assert.match(String(doc["text"]), /confenge\.get_context/);
    assert.match(String(doc["text"]), /preflight/i);

    const prompts = await rpc(runtime, {
      jsonrpc: "2.0",
      id: 5,
      method: "prompts/list",
      params: { _meta: authMeta(TEST_TOKEN) },
    });
    assert.ok(prompts);
    const promptResult = prompts["result"];
    assert.ok(isRecord(promptResult));
    const promptList = promptResult["prompts"];
    assert.ok(Array.isArray(promptList));
    const promptNames = promptList.map((row) => {
      assert.ok(isRecord(row));
      return row["name"];
    });
    assert.ok(promptNames.includes(PROMPT_NAMES.preflight));

    const got = await rpc(runtime, {
      jsonrpc: "2.0",
      id: 6,
      method: "prompts/get",
      params: {
        name: PROMPT_NAMES.preflight,
        arguments: { scope: "ops.commercial" },
        _meta: authMeta(TEST_TOKEN),
      },
    });
    assert.ok(got);
    const gotResult = got["result"];
    assert.ok(isRecord(gotResult));
    const messages = gotResult["messages"];
    assert.ok(Array.isArray(messages));
    const message = messages[0];
    assert.ok(isRecord(message));
    const content = message["content"];
    assert.ok(isRecord(content));
    assert.match(String(content["text"]), /confenge\.get_context/);
    assert.match(String(content["text"]), /ops\.commercial/);
  });

  it("returns scoped context with provenance and omits other scopes and the company dump", async () => {
    const { runtime } = boot();
    await handshake(runtime);
    const reply = await callTool(runtime, "confenge.get_context", { scope: "ops.commercial" });
    const payload = toolPayload(reply);
    assert.equal(payload.isError, false);
    assert.ok(isRecord(payload.data));
    assert.equal(payload.data["scope"], "ops.commercial");
    assertProvenance(payload.data, "get_context");
    const encoded = JSON.stringify(payload.data);
    assert.match(encoded, new RegExp(MARKERS.commercial));
    assert.doesNotMatch(encoded, new RegExp(MARKERS.finance));
    assert.doesNotMatch(encoded, new RegExp(MARKERS.companyDump));
    assert.doesNotMatch(encoded, new RegExp(MARKERS.beta));
    const records = payload.data["records"];
    assert.ok(Array.isArray(records) && records.length > 0);
    const scopes = new Set<string>();
    for (const record of records) {
      assertProvenance(record, "get_context.record");
      assert.ok(isRecord(record));
      const scope = String(record["scope"]);
      scopes.add(scope);
      assert.ok(
        scope === "ops.commercial" || scope === "company",
        `unexpected scope ${scope} in commercial context`,
      );
    }
    assert.ok(scopes.has("ops.commercial"));
  });

  it("scopes active directives and client context", async () => {
    const { runtime } = boot();
    await handshake(runtime);

    const directivesReply = await callTool(runtime, "confenge.get_active_directives", {
      scope: "ops.commercial",
    });
    const directivesPayload = toolPayload(directivesReply);
    assert.equal(directivesPayload.isError, false);
    assert.ok(isRecord(directivesPayload.data));
    assertProvenance(directivesPayload.data, "get_active_directives");
    const directives = directivesPayload.data["directives"];
    assert.ok(Array.isArray(directives) && directives.length > 0);
    const encoded = JSON.stringify(directives);
    assert.match(encoded, /dir-comm-1/);
    assert.doesNotMatch(encoded, /dir-fin-1/);
    assert.doesNotMatch(encoded, /dir-comm-old/);
    assert.doesNotMatch(encoded, new RegExp(MARKERS.companyDump));
    for (const row of directives) {
      assert.ok(isRecord(row));
      assertProvenance(row, "directive");
      const scope = String(row["scope"]);
      assert.ok(
        scope === "ops.commercial" || scope === "company",
        `unexpected directive scope ${scope}`,
      );
      assert.notEqual(scope, "ops.finance");
      assert.equal(row["status"], "active");
      assert.equal(typeof row["effective_from"], "string");
      assert.equal(typeof row["created_by"], "string");
      assert.ok("expires_at" in row);
      assert.ok("supersedes" in row);
      assert.ok(isRecord(row["audit"]));
    }

    const clientReply = await callTool(runtime, "confenge.get_client_context", { client: "acme-ltda" });
    const clientPayload = toolPayload(clientReply);
    assert.equal(clientPayload.isError, false);
    assert.ok(isRecord(clientPayload.data));
    assertProvenance(clientPayload.data, "get_client_context");
    const clientEncoded = JSON.stringify(clientPayload.data);
    assert.match(clientEncoded, new RegExp(MARKERS.acme));
    assert.doesNotMatch(clientEncoded, new RegExp(MARKERS.beta));
    assert.doesNotMatch(clientEncoded, new RegExp(MARKERS.companyDump));
    assert.doesNotMatch(clientEncoded, new RegExp(MARKERS.finance));
  });

  it("honors get_decisions since and returns provenance", async () => {
    const { runtime } = boot();
    await handshake(runtime);

    const allReply = await callTool(runtime, "confenge.get_decisions", {});
    const allPayload = toolPayload(allReply);
    assert.ok(isRecord(allPayload.data));
    const all = allPayload.data["decisions"];
    assert.ok(Array.isArray(all));
    assert.equal(all.length, 3);
    for (const row of all) {
      assertProvenance(row, "decision");
    }

    const sinceReply = await callTool(runtime, "confenge.get_decisions", {
      since: "2026-08-01T00:00:00.000Z",
    });
    const sincePayload = toolPayload(sinceReply);
    assert.ok(isRecord(sincePayload.data));
    const since = sincePayload.data["decisions"];
    assert.ok(Array.isArray(since));
    const ids = since.map((row) => {
      assert.ok(isRecord(row));
      return row["id"];
    });
    assert.deepEqual(ids, ["dec-2", "dec-3"]);
    assert.ok(!ids.includes("dec-1"));
  });

  it("returns company state and priorities without the memory dump", async () => {
    const { runtime } = boot();
    await handshake(runtime);

    const stateReply = await callTool(runtime, "confenge.get_company_state", {});
    const state = toolPayload(stateReply);
    assert.equal(state.isError, false);
    assert.ok(isRecord(state.data));
    assertProvenance(state.data, "company_state");
    const encoded = JSON.stringify(state.data);
    assert.doesNotMatch(encoded, new RegExp(MARKERS.companyDump));
    const top = state.data["top_three"];
    assert.ok(Array.isArray(top) && top.length === 3);
    for (const row of top) {
      assertProvenance(row, "priority");
    }

    const priReply = await callTool(runtime, "confenge.get_priorities", {});
    const pri = toolPayload(priReply);
    assert.ok(isRecord(pri.data));
    const list = pri.data["priorities"];
    assert.ok(Array.isArray(list) && list.length === 3);
  });

  it("accepts session result and blocker writes", async () => {
    const { runtime } = boot();
    await handshake(runtime);

    const resultReply = await callTool(runtime, "confenge.report_session_result", {
      session_id: "sess-1",
      scope: "ops.commercial",
      summary: "Reviewed ACME exception; no outbound send.",
      outcome: "completed",
    });
    const resultPayload = toolPayload(resultReply);
    assert.equal(resultPayload.isError, false);
    assert.ok(isRecord(resultPayload.data));
    assert.equal(resultPayload.data["accepted"], true);
    assert.equal(resultPayload.data["kind"], "session_result");
    assertProvenance(resultPayload.data, "session_result");

    const again = await callTool(runtime, "confenge.report_session_result", {
      session_id: "sess-1",
      scope: "ops.commercial",
      summary: "duplicate",
      outcome: "completed",
    });
    const againPayload = toolPayload(again);
    assert.ok(isRecord(againPayload.data));
    assert.equal(againPayload.data["id"], resultPayload.data["id"]);

    const blockerReply = await callTool(runtime, "confenge.report_blocker", {
      scope: "ops.commercial",
      summary: "Legal packet still stale",
      severity: "high",
      blocking: true,
    });
    const blockerPayload = toolPayload(blockerReply);
    assert.equal(blockerPayload.isError, false);
    assert.ok(isRecord(blockerPayload.data));
    assert.equal(blockerPayload.data["accepted"], true);
    assert.equal(blockerPayload.data["kind"], "blocker");
    assertProvenance(blockerPayload.data, "blocker");
  });

  it("rejects attempts to create or alter decisions, constraints, or authoritative directives", async () => {
    const { runtime } = boot();
    await handshake(runtime);

    const smuggle = await callTool(runtime, "confenge.report_session_result", {
      scope: "ops.commercial",
      summary: "trying to write memory",
      outcome: "completed",
      create_directive: { kind: "directive", body: "new rule" },
    });
    const smuggleErr = errorData(smuggle);
    assert.equal(smuggleErr.code, "FORBIDDEN_MUTATION");
    assert.ok(smuggleErr.correlation_id.length > 0);

    const create = await callTool(runtime, "confenge.create_directive", {
      kind: "directive",
      body: "nope",
      action: "create",
    });
    const createErr = errorData(create);
    assert.equal(createErr.code, "FORBIDDEN_MUTATION");

    const decision = await callTool(runtime, "confenge.report_blocker", {
      scope: "company",
      summary: "mutate",
      severity: "low",
      action: "create",
      kind: "decision",
    });
    const decisionErr = errorData(decision);
    assert.equal(decisionErr.code, "FORBIDDEN_MUTATION");
  });
});
