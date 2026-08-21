import { parseActor } from "./actor.ts";
import { frozenClock, systemClock, type Clock } from "./clock.ts";
import { invalid } from "./errors.ts";
import { cryptoIds } from "./ids.ts";
import { createLogger, type Logger } from "./log.ts";
import { REPRESENTATIVE_NOW, REPRESENTATIVE_REPO_DOMAINS, seedRepresentative } from "./representative.ts";
import { parseRepoDomainMap, type RepoDomainMap } from "./scope.ts";
import { createContextService, type ContextService } from "./service.ts";
import { createOperationalPortFromEnv } from "./operational/from-env.ts";
import { createOperationalService, type OperationalService } from "./operational/service.ts";
import { createStoreFromEnv, createStoreFromEnvAsync } from "./store/from-env.ts";
import type { PersistencePort } from "./store/adapter.ts";
import { sanitizeActorId } from "./sanitize.ts";
import type { ActorRef, Scope } from "./types.ts";

export interface BootResult {
  service: ContextService;
  operational: OperationalService;
  founderActorId: string;
  defaultScope: Scope;
  fixture: string;
  storeName: "fixture" | "postgres";
  repoDomains: RepoDomainMap;
}

export function readFounderActorId(env: NodeJS.ProcessEnv): string {
  const raw = env.CONTROL_CENTER_FOUNDER_ACTOR_ID;
  if (!raw || raw.trim() === "") {
    throw invalid("CONTROL_CENTER_FOUNDER_ACTOR_ID is required");
  }
  return sanitizeActorId(raw, "CONTROL_CENTER_FOUNDER_ACTOR_ID");
}

function repoDomainsFromEnv(env: NodeJS.ProcessEnv, fixture: string): RepoDomainMap {
  const parsed = parseRepoDomainMap(env.CONTROL_CENTER_REPO_DOMAINS);
  if (fixture === "representative") {
    return { ...REPRESENTATIVE_REPO_DOMAINS, ...parsed };
  }
  return parsed;
}

function assembleBoot(
  env: NodeJS.ProcessEnv,
  store: PersistencePort,
  storeName: BootResult["storeName"],
  opts?: { logger?: Logger; clock?: Clock },
): BootResult {
  const founderActorId = readFounderActorId(env);
  const defaultScope: Scope = "company";
  const fixture = (env.CONTEXT_SERVICE_FIXTURE ?? "empty").trim() || "empty";
  const clock =
    opts?.clock ??
    (fixture === "representative" ? frozenClock(REPRESENTATIVE_NOW) : systemClock);
  if (fixture === "representative") {
    seedRepresentative(store);
  } else if (fixture !== "empty") {
    throw invalid("CONTEXT_SERVICE_FIXTURE must be representative or empty");
  }
  const repoDomains = repoDomainsFromEnv(env, fixture);
  const logger = opts?.logger ?? createLogger();
  const service = createContextService({
    store,
    clock,
    ids: cryptoIds,
    founderActorId,
    logger,
    defaultScope,
    repoDomains,
  });
  const operational = createOperationalService({
    port: createOperationalPortFromEnv(env),
    clock,
    founderActorId,
    repoDomains,
  });
  return { service, operational, founderActorId, defaultScope, fixture, storeName, repoDomains };
}

export function bootFromEnv(
  env: NodeJS.ProcessEnv,
  opts?: { logger?: Logger; clock?: Clock },
): BootResult {
  const store = createStoreFromEnv(env);
  return assembleBoot(env, store, "fixture", opts);
}

export async function bootFromEnvAsync(
  env: NodeJS.ProcessEnv,
  opts?: { logger?: Logger; clock?: Clock },
): Promise<BootResult> {
  const { store, storeName } = await createStoreFromEnvAsync(env);
  const boot = assembleBoot(env, store, storeName, opts);
  if (store.flush) {
    await store.flush();
  }
  return boot;
}

export function actorFromEnv(env: NodeJS.ProcessEnv): ActorRef {
  return parseActor(env.CONTEXT_ACTOR_ID, env.CONTEXT_ACTOR_KIND);
}
