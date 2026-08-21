#!/usr/bin/env node
/**
 * Production-path context process: real Postgres + founder-seeded directives.
 * Production HTTP + Postgres only. Used by e2e and live QA.
 */
import { createServer } from "node:http";
import { startIsolatedTestPostgres } from "../persistence/tests/helpers/postgres.js";
import { createPersistence } from "../persistence/src/index.js";
import {
  createContextService,
  createOperationalService,
  createPostgresOperationalPortFromPool,
  createPostgresStoreFromPool,
  createRequestListener,
  cryptoIds,
  frozenClock,
  silentLogger,
} from "../services/context/src/index.ts";
import { FOUNDER, LIVE_NOW, seedLiveCockpit, seedOperationalCockpit } from "../tests/convergence/live-runtime/seed.ts";

function listenPort(env: NodeJS.ProcessEnv): number {
  const port = Number.parseInt(env.PORT ?? "8787", 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer 0-65535");
  }
  return port;
}

const host = (process.env.HOST ?? "127.0.0.1").trim();
const port = listenPort(process.env);
const founderActorId = (process.env.CONTROL_CENTER_FOUNDER_ACTOR_ID ?? FOUNDER.id).trim();

const pg = await startIsolatedTestPostgres();
const store = await createPostgresStoreFromPool(pg.pool);
const persistence = createPersistence(pg.pool);
const repoDomains = { "tjsasakifln/Governance": "commercial", Governance: "commercial" };
const service = createContextService({
  store,
  clock: frozenClock(LIVE_NOW),
  ids: cryptoIds,
  founderActorId,
  logger: silentLogger,
  defaultScope: "company",
  repoDomains,
});
seedLiveCockpit(service);
await service.flush();
await seedOperationalCockpit(persistence);
const operational = createOperationalService({
  port: createPostgresOperationalPortFromPool(pg.pool),
  clock: frozenClock(LIVE_NOW),
  founderActorId,
  repoDomains,
});

const server = createServer(createRequestListener({ service, operational, logger: silentLogger }));
server.listen(port, host, () => {
  process.stdout.write(
    `${JSON.stringify({ ok: true, service: "control-center-context", store: "postgres", host, port })}\n`,
  );
});

const shutdown = async () => {
  server.close();
  await pg.stop();
  process.exit(0);
};
process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
