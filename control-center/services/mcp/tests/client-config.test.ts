import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { TOOL_ALIAS_NAMES } from "../src/types.js";

const agentsDocs = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../docs/agents",
);

function read(name: string): string {
  return readFileSync(path.join(agentsDocs, name), "utf8");
}

describe("native client configs and agent docs", () => {
  it("ships Grok and Codex configs that use undotted aliases, env tokens, and no scratch proxy", () => {
    const grok = read("grok.mcp.toml.example");
    const codex = read("codex.config.toml.example");
    const readme = read("README.md");
    const http = read("mcp.http-jsonrpc.example.json");

    for (const body of [grok, codex]) {
      assert.match(body, /\[mcp_servers\.confenge\]/);
      assert.match(body, /CONFENGE_MCP_AUTH_TOKEN = "\$\{CONFENGE_MCP_AUTH_TOKEN\}"/);
      assert.match(body, /control-center\/services\/mcp\/src\/index\.ts/);
      assert.doesNotMatch(body, /name-rewrite|scratch-proxy|rewrite-proxy/i);
      assert.match(body, /mcp\.confenge\.com\.br/);
      assert.doesNotMatch(body, /url\s*=\s*"https:\/\/mcp\.confenge\.com\.br/);
      assert.doesNotMatch(body, /Bearer\s+(?!\$\{)[A-Za-z0-9._-]{12,}/);
      assert.doesNotMatch(body, /ghp_/);
      assert.doesNotMatch(body, /CONFENGE_MCP_AUTH_TOKEN=[^\s"$]+/);
    }

    assert.match(grok, /confenge__get_context/);
    assert.match(codex, /NOT_TESTED_CLIENT_MISSING/);
    assert.match(readme, /HTTP JSON-RPC/);
    assert.match(readme, /stdio/);
    assert.match(readme, /loopback/i);
    assert.match(readme, /mcp\.confenge\.com\.br/);
    assert.match(readme, /Do not create/);
    for (const alias of TOOL_ALIAS_NAMES) {
      assert.match(readme, new RegExp(`\\b${alias}\\b`));
      assert.match(http, new RegExp(`"${alias}"`));
    }
  });

  it("does not commit live tokens in owned agent docs", () => {
    const files = readdirSync(agentsDocs);
    assert.ok(files.includes("grok.mcp.toml.example"));
    assert.ok(files.includes("codex.config.toml.example"));
    for (const name of files) {
      const body = read(name);
      assert.doesNotMatch(body, /ghp_[A-Za-z0-9_]+/);
      assert.doesNotMatch(body, /github_pat_[A-Za-z0-9_]+/);
      assert.doesNotMatch(body, /CONFENGE_MCP_AUTH_TOKEN=(?!\$\{)(?!")\S+/);
      assert.doesNotMatch(body, /CONFENGE_MCP_AUTH_TOKEN="(?!\$\{)[^"]+"/);
      assert.doesNotMatch(body, /Bearer\s+(?!\$\{)[A-Za-z0-9._-]{16,}/);
    }
  });
});
