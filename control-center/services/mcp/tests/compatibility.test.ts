import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MARKERS } from "../src/fixtures.js";
import {
  TOOL_ALIAS_NAMES,
  TOOL_ALIAS_TO_CANONICAL,
  TOOL_NAMES,
  canonicalToolName,
} from "../src/types.js";
import {
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

const PAIRS: Array<{ canonical: (typeof TOOL_NAMES)[number]; alias: (typeof TOOL_ALIAS_NAMES)[number] }> =
  TOOL_ALIAS_NAMES.map((alias) => ({
    canonical: TOOL_ALIAS_TO_CANONICAL[alias],
    alias,
  }));

describe("MCP undotted compatibility aliases", () => {
  it("advertises eight canonical names and eight undotted aliases with metadata", async () => {
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
    assert.equal(tools.length, 16);

    const byName = new Map<string, Record<string, unknown>>();
    for (const tool of tools) {
      assert.ok(isRecord(tool));
      byName.set(String(tool["name"]), tool);
    }

    for (const canonical of TOOL_NAMES) {
      const row = byName.get(canonical);
      assert.ok(row, `missing canonical ${canonical}`);
      const meta = row["_meta"];
      if (isRecord(meta)) {
        assert.notEqual(meta["compatibility_alias"], true);
      }
    }

    for (const alias of TOOL_ALIAS_NAMES) {
      const row = byName.get(alias);
      assert.ok(row, `missing alias ${alias}`);
      const meta = row["_meta"];
      assert.ok(isRecord(meta), `${alias} must be marked as a compatibility alias in metadata`);
      assert.equal(meta["compatibility_alias"], true);
      assert.equal(meta["canonical_name"], TOOL_ALIAS_TO_CANONICAL[alias]);
      assert.equal(JSON.stringify(row["inputSchema"]), JSON.stringify(byName.get(TOOL_ALIAS_TO_CANONICAL[alias])?.["inputSchema"]));
    }
  });

  it("routes each alias through the same implementation, validation, and correlation id as its canonical peer", async () => {
    const { runtime } = boot();
    await handshake(runtime);
    const correlationId = "cc-mcp-alias-equivalence";

    const cases: Array<{ canonical: string; alias: string; args: Record<string, unknown> }> = [
      { canonical: "confenge.get_company_state", alias: "get_company_state", args: {} },
      { canonical: "confenge.get_context", alias: "get_context", args: { scope: "ops.commercial" } },
      { canonical: "confenge.get_active_directives", alias: "get_active_directives", args: { scope: "ops.commercial" } },
      { canonical: "confenge.get_priorities", alias: "get_priorities", args: {} },
      { canonical: "confenge.get_client_context", alias: "get_client_context", args: { client: "acme-ltda" } },
      { canonical: "confenge.get_decisions", alias: "get_decisions", args: { since: "2026-08-01T00:00:00.000Z" } },
    ];

    for (const item of cases) {
      const canonicalReply = await rpc(runtime, {
        jsonrpc: "2.0",
        id: `eq-${item.alias}-canonical`,
        method: "tools/call",
        params: {
          name: item.canonical,
          arguments: item.args,
          _meta: { ...authMeta(TEST_TOKEN), correlation_id: correlationId },
        },
      });
      const aliasReply = await rpc(runtime, {
        jsonrpc: "2.0",
        id: `eq-${item.alias}-alias`,
        method: "tools/call",
        params: {
          name: item.alias,
          arguments: item.args,
          _meta: { ...authMeta(TEST_TOKEN), correlation_id: correlationId },
        },
      });
      assert.ok(canonicalReply);
      assert.ok(aliasReply);
      const canonicalPayload = toolPayload(canonicalReply);
      const aliasPayload = toolPayload(aliasReply);
      assert.equal(canonicalPayload.isError, false);
      assert.equal(aliasPayload.isError, false);
      assert.equal(canonicalPayload.correlation_id, correlationId);
      assert.equal(aliasPayload.correlation_id, correlationId);
      assert.equal(canonicalPayload.canonical_name, item.canonical);
      assert.equal(aliasPayload.canonical_name, item.canonical);
      assert.equal(canonicalPayload.invoked_name, item.canonical);
      assert.equal(aliasPayload.invoked_name, item.alias);
      assert.deepEqual(aliasPayload.data, canonicalPayload.data);
    }

    const missingCanonical = await callTool(runtime, "confenge.get_context", {});
    const missingAlias = await callTool(runtime, "get_context", {});
    assert.equal(errorData(missingCanonical).code, errorData(missingAlias).code);
    assert.equal(errorData(missingAlias).code, "MISSING_SCOPE");
  });

  it("does not duplicate activity when a report is repeated across canonical and alias names", async () => {
    const { runtime } = boot();
    await handshake(runtime);
    const args = {
      session_id: "alias-dup-session",
      scope: "ops.commercial",
      summary: "Same report via both name families",
      outcome: "completed",
    };
    const first = toolPayload(await callTool(runtime, "confenge.report_session_result", args));
    const second = toolPayload(await callTool(runtime, "report_session_result", args));
    assert.equal(first.data && isRecord(first.data) ? first.data["accepted"] : false, true);
    assert.ok(isRecord(first.data) && isRecord(second.data));
    assert.equal(second.data["id"], first.data["id"]);
    assert.equal(second.data["kind"], "session_result");
    assert.equal(second.canonical_name, "confenge.report_session_result");

    const blockerArgs = {
      scope: "ops.commercial",
      summary: "Legal packet still stale (alias mix)",
      severity: "high",
      blocking: true,
    };
    const blockerCanonical = toolPayload(await callTool(runtime, "confenge.report_blocker", blockerArgs));
    const blockerAlias = toolPayload(await callTool(runtime, "report_blocker", blockerArgs));
    assert.ok(isRecord(blockerCanonical.data) && isRecord(blockerAlias.data));
    assert.equal(blockerAlias.data["id"], blockerCanonical.data["id"]);
    assert.equal(blockerAlias.data["kind"], "blocker");
  });

  it("fail-closes missing and wrong tokens on alias names and returns no records", async () => {
    const { runtime } = boot();
    await handshake(runtime);

    const missing = await callTool(runtime, "get_context", { scope: "ops.commercial" }, { token: undefined });
    const missingErr = errorData(missing);
    assert.equal(missingErr.code, "UNAUTHENTICATED");
    assert.equal(missing["result"], undefined);
    assert.doesNotMatch(JSON.stringify(missing), new RegExp(MARKERS.commercial));
    assert.doesNotMatch(JSON.stringify(missing), new RegExp(MARKERS.repoGovernance));

    const wrong = "definitely-not-the-configured-token";
    const invalid = await callTool(runtime, "get_context", { scope: "repo:Governance" }, { token: wrong });
    const invalidErr = errorData(invalid);
    assert.equal(invalidErr.code, "INVALID_TOKEN");
    assert.equal(invalid["result"], undefined);
    assert.doesNotMatch(JSON.stringify(invalid), new RegExp(MARKERS.repoGovernance));
    assert.doesNotMatch(JSON.stringify(invalid), new RegExp(TEST_TOKEN));
    assert.doesNotMatch(JSON.stringify(invalid), new RegExp(wrong));
  });

  it("keeps sibling scopes from leaking and inherits company records on both name families", async () => {
    const { runtime } = boot();
    await handshake(runtime);

    for (const name of ["confenge.get_context", "get_context"] as const) {
      const commercial = toolPayload(await callTool(runtime, name, { scope: "ops.commercial" }));
      assert.ok(isRecord(commercial.data));
      const encoded = JSON.stringify(commercial.data);
      assert.match(encoded, new RegExp(MARKERS.commercial));
      assert.doesNotMatch(encoded, new RegExp(MARKERS.finance));
      assert.doesNotMatch(encoded, new RegExp(MARKERS.companyDump));
      assert.doesNotMatch(encoded, new RegExp(MARKERS.beta));
      const records = commercial.data["records"];
      assert.ok(Array.isArray(records));
      const scopes = records.map((row) => {
        assert.ok(isRecord(row));
        return String(row["scope"]);
      });
      assert.ok(scopes.includes("ops.commercial"));
      assert.ok(scopes.includes("company"), `${name} must inherit company records`);
      assert.ok(!scopes.includes("ops.finance"));
    }

    const repo = toolPayload(await callTool(runtime, "get_context", { scope: "repo:Governance" }));
    assert.ok(isRecord(repo.data));
    const repoEncoded = JSON.stringify(repo.data);
    assert.match(repoEncoded, new RegExp(MARKERS.repoGovernance));
    assert.doesNotMatch(repoEncoded, new RegExp(MARKERS.finance));
    assert.doesNotMatch(repoEncoded, new RegExp(MARKERS.companyDump));
    const repoRecords = repo.data["records"];
    assert.ok(Array.isArray(repoRecords) && repoRecords.length > 0);
    const repoScopes = repoRecords.map((row) => {
      assert.ok(isRecord(row));
      return String(row["scope"]);
    });
    assert.ok(repoScopes.includes("repo:Governance"));
    assert.ok(repoScopes.includes("company"));
  });

  it("does not promote hypothesis records into decisions on either name family", async () => {
    const { runtime } = boot();
    await handshake(runtime);

    const context = toolPayload(await callTool(runtime, "get_context", { scope: "ops.commercial" }));
    assert.ok(isRecord(context.data));
    const records = context.data["records"];
    assert.ok(Array.isArray(records));
    const hypothesis = records.find((row) => isRecord(row) && row["kind"] === "hypothesis");
    assert.ok(isRecord(hypothesis));
    assert.match(String(hypothesis["body"]), new RegExp(MARKERS.hypothesis));

    const decisions = toolPayload(await callTool(runtime, "get_decisions", {}));
    assert.ok(isRecord(decisions.data));
    const encoded = JSON.stringify(decisions.data);
    assert.doesNotMatch(encoded, new RegExp(MARKERS.hypothesis));
    const list = decisions.data["decisions"];
    assert.ok(Array.isArray(list));
    for (const row of list) {
      assert.ok(isRecord(row));
      assert.equal(row["kind"], "decision");
    }
  });

  it("denies decision/constraint mutation through both name families and does not accept Authelia cookies", async () => {
    const { runtime } = boot();
    await handshake(runtime);

    const smuggleAlias = await callTool(runtime, "report_session_result", {
      scope: "ops.commercial",
      summary: "trying to write memory via alias",
      outcome: "completed",
      create_directive: { kind: "directive", body: "new rule" },
    });
    assert.equal(errorData(smuggleAlias).code, "FORBIDDEN_MUTATION");

    const smuggleCanonical = await callTool(runtime, "confenge.report_blocker", {
      scope: "company",
      summary: "mutate",
      severity: "low",
      action: "create",
      kind: "constraint",
    });
    assert.equal(errorData(smuggleCanonical).code, "FORBIDDEN_MUTATION");

    const cookieOnly = await rpc(runtime, {
      jsonrpc: "2.0",
      id: 80,
      method: "tools/call",
      params: {
        name: "get_context",
        arguments: { scope: "ops.commercial" },
        _meta: { cookie: "authelia_session=forged-founder-approval" },
      },
    });
    assert.ok(cookieOnly);
    assert.equal(errorData(cookieOnly).code, "UNAUTHENTICATED");
    assert.doesNotMatch(JSON.stringify(cookieOnly), new RegExp(MARKERS.commercial));
  });

  it("maps every advertised alias onto a canonical tool and adds no extra capability", () => {
    assert.equal(TOOL_ALIAS_NAMES.length, 8);
    assert.equal(TOOL_NAMES.length, 8);
    for (const alias of TOOL_ALIAS_NAMES) {
      assert.equal(canonicalToolName(alias), TOOL_ALIAS_TO_CANONICAL[alias]);
      assert.equal(canonicalToolName(TOOL_ALIAS_TO_CANONICAL[alias]), TOOL_ALIAS_TO_CANONICAL[alias]);
    }
    assert.equal(canonicalToolName("create_directive"), undefined);
    assert.equal(canonicalToolName("confenge.charge"), undefined);
    void PAIRS;
  });
});
