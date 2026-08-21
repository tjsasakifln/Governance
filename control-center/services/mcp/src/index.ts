#!/usr/bin/env node
import { createLogger } from "./logging.js";
import { serveHttp } from "./http.js";
import { createMcpRuntime, loadAuthTokenFromEnv, loadRateLimitFromEnv } from "./server.js";
import { serveStdio } from "./stdio.js";
import { createContextApiFromEnv } from "./context-http.js";
import { createStubContextApi } from "./stub-adapter.js";

async function main(): Promise<void> {
  const logger = createLogger();
  const authToken = loadAuthTokenFromEnv();
  if (authToken === undefined) {
    logger.error("mcp.boot_fail_closed", {
      reason: "CONFENGE_MCP_AUTH_TOKEN is missing; context will not be served",
    });
  }

  let context;
  try {
    context = createContextApiFromEnv(process.env, createStubContextApi);
  } catch (err) {
    const message = err instanceof Error ? err.message : "context api misconfigured";
    logger.error("mcp.boot_fail_closed", { reason: message });
    process.exitCode = 1;
    return;
  }

  const runtime = createMcpRuntime({
    context,
    authToken,
    logger,
    rateLimit: loadRateLimitFromEnv(),
    secretsToRedact: authToken ? [authToken] : [],
  });

  const portRaw = process.env["CONFENGE_MCP_HTTP_PORT"];
  if (portRaw !== undefined && portRaw.trim().length > 0) {
    const port = Number.parseInt(portRaw, 10);
    if (!Number.isFinite(port) || port <= 0) {
      logger.error("mcp.boot_invalid_port", { reason: "CONFENGE_MCP_HTTP_PORT is not a valid port" });
      process.exitCode = 1;
      return;
    }
    const host = process.env["CONFENGE_MCP_HTTP_HOST"]?.trim() || "127.0.0.1";
    serveHttp(runtime, logger, { host, port });
    return;
  }

  await serveStdio(runtime, logger);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "boot failed";
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: "error", msg: "mcp.crash", err: message })}\n`);
  process.exit(1);
});
