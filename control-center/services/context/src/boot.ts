import { parseActor } from "./actor.ts";
import { frozenClock, systemClock, type Clock } from "./clock.ts";
import { invalid } from "./errors.ts";
import { cryptoIds } from "./ids.ts";
import { createLogger, type Logger } from "./log.ts";
import { REPRESENTATIVE_NOW, REPRESENTATIVE_REPO_DOMAINS, seedRepresentative } from "./representative.ts";
import { parseRepoDomainMap, type RepoDomainMap } from "./scope.ts";
import { createContextService, type ContextService } from "./service.ts";
import { createStoreFromEnv } from "./store/from-env.ts";
import { sanitizeActorId } from "./sanitize.ts";
import type { ActorRef, Scope } from "./types.ts";

export interface BootResult {
  service: ContextService;
  founderActorId: string;
  defaultScope: Scope;
  fixture: string;
  storeName: "fixture";
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

export function bootFromEnv(
  env: NodeJS.ProcessEnv,
  opts?: { logger?: Logger; clock?: Clock },
): BootResult {
  const founderActorId = readFounderActorId(env);
  const defaultScope: Scope = "company";
  const store = createStoreFromEnv(env);
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
  return { service, founderActorId, defaultScope, fixture, storeName: "fixture", repoDomains };
}

export function actorFromEnv(env: NodeJS.ProcessEnv): ActorRef {
  return parseActor(env.CONTEXT_ACTOR_ID, env.CONTEXT_ACTOR_KIND);
}
