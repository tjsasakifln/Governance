import { createServer } from "node:http";
import { bootFromEnvAsync } from "./boot.ts";
import { createRequestListener } from "./http.ts";
import { createWarmblyOperatorHandlerFromEnv } from "./warmbly-operator/from-env.ts";
import { createOperatorActorResolverFromEnv } from "./security/operator-identity.ts";
import { createLogger, type Logger } from "./log.ts";
import { isServiceError } from "./errors.ts";
import { runtimeIdentityFromEnv } from "./runtime-identity.ts";

function listenPort(env: NodeJS.ProcessEnv): number {
  const raw = env.PORT ?? "8787";
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer 0-65535");
  }
  return port;
}

function listenHost(env: NodeJS.ProcessEnv): string {
  const host = (env.HOST ?? "127.0.0.1").trim();
  if (!host) {
    throw new Error("HOST must not be empty");
  }
  return host;
}

export async function startServer(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { logger?: Logger },
): Promise<{ server: ReturnType<typeof createServer>; host: string; port: number }> {
  const logger = opts?.logger ?? createLogger();
  const boot = await bootFromEnvAsync(env, { logger });
  const host = listenHost(env);
  const port = listenPort(env);
  // Off unless CC_WARMBLY_OPERATOR_ENABLED=true. When absent, every operator
  // route 404s rather than falling back to a weaker identity path.
  const warmblyOperator = await createWarmblyOperatorHandlerFromEnv(env, { logger });
  const operatorActor = createOperatorActorResolverFromEnv(env);
  const listener = createRequestListener({
    service: boot.service,
    operational: boot.operational,
    operatorActions: boot.operatorActions,
    warmblyReview: boot.warmblyReview,
    logger,
    runtimeIdentity: runtimeIdentityFromEnv(env, "control-center-context"),
    ...(operatorActor ? { operatorActor } : {}),
    ...(warmblyOperator ? { warmblyOperator } : {}),
  });
  const server = createServer(listener);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const bound = addr && typeof addr === "object" ? addr.port : port;
      logger.info("listen", {
        host,
        port: bound,
        fixture: boot.fixture,
        store: boot.storeName,
      });
      resolve({ server, host, port: bound });
    });
  });
}

function isDirectEntry(): boolean {
  const arg = process.argv[1];
  if (!arg) {
    return false;
  }
  const normalized = arg.replace(/\\/g, "/");
  return normalized.endsWith("/server.ts") || normalized.endsWith("/server.js");
}

if (isDirectEntry()) {
  startServer().catch((err: unknown) => {
    if (isServiceError(err)) {
      process.stderr.write(`${JSON.stringify({ level: "error", msg: err.message, code: err.code })}\n`);
    } else {
      process.stderr.write(`${JSON.stringify({ level: "error", msg: "boot_failed" })}\n`);
    }
    process.exit(1);
  });
}
