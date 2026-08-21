import { writeFileSync } from "node:fs";
import { bootLiveRuntime, httpJson, mcpCall, mcpInitialize } from "./harness.ts";

const out = process.argv[2];
const rt = await bootLiveRuntime();
try {
  const ctx = await httpJson(`${rt.contextBaseUrl}/v1/context?scope=company`, {
    headers: rt.founderHeaders,
  });
  await mcpInitialize(rt.mcp);
  const read = await mcpCall(rt.mcp, "confenge.get_context", { scope: "company" });
  const denied = await mcpCall(rt.mcp, "confenge.create_decision", { kind: "decision" });
  const payload = {
    http_status: ctx.status,
    context: ctx.body,
    mcp_read_error: read.error ?? null,
    mcp_mutation: denied.error ?? denied.result ?? null,
  };
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  process.stdout.write(text);
  if (out) writeFileSync(out, text);
} finally {
  await rt.stop();
}
