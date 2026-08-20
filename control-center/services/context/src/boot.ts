import { parseActor } from "./actor.ts";
import { frozenClock, systemClock, type Clock } from "./clock.ts";
import { invalid } from "./errors.ts";
import { cryptoIds } from "./ids.ts";
import { createLogger, type Logger } from "./log.ts";
import { REPRESENTATIVE_NOW, seedRepresentative } from "./representative.ts";
import { createContextService, type ContextService } from "./service.ts";
import { createStoreFromEnv } from "./store/from-env.ts";
import { sanitizeActorId } from "./sanitize.ts";
import type { Actor } from "./types.ts";

export interface BootResult {
  service: ContextService;
  founderActorId: string;
  defaultCompany: string;
  fixture: string;
  storeName: "fixture";
}

export function readFounderActorId(env: NodeJS.ProcessEnv): string {
  const raw = env.CONTROL_CENTER_FOUNDER_ACTOR_ID;
  if (!raw || raw.trim() === "") {
    throw invalid("CONTROL_CENTER_FOUNDER_ACTOR_ID is required");
  }
  return sanitizeActorId(raw, "CONTROL_CENTER_FOUNDER_ACTOR_ID");
}

export function bootFromEnv(
  env: NodeJS.ProcessEnv,
  opts?: { logger?: Logger; clock?: Clock },
): BootResult {
  const founderActorId = readFounderActorId(env);
  const defaultCompany = (env.CONTROL_CENTER_COMPANY ?? "confenge").trim() || "confenge";
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
  const logger = opts?.logger ?? createLogger();
  const service = createContextService({
    store,
    clock,
    ids: cryptoIds,
    founderActorId,
    logger,
    defaultCompany,
  });
  return { service, founderActorId, defaultCompany, fixture, storeName: "fixture" };
}

export function actorFromEnv(env: NodeJS.ProcessEnv): Actor {
  return parseActor(env.CONTEXT_ACTOR_ID, env.CONTEXT_ACTOR_ROLE);
}
