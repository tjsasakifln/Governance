import { frozenClock } from "../src/clock.ts";
import { sequentialIds } from "../src/ids.ts";
import { silentLogger } from "../src/log.ts";
import { REPRESENTATIVE_REPO_DOMAINS } from "../src/representative.ts";
import { createContextService, type ContextService } from "../src/service.ts";
import { createFixtureStore } from "../src/store/fixture.ts";
import type { ActorRef, CreateDirectiveInput, SourceRef } from "../src/types.ts";
import type { PersistencePort } from "../src/store/adapter.ts";

export const NOW = "2026-08-20T12:00:00.000Z";

export const FOUNDER: ActorRef = { id: "founder-test", kind: "human" };
export const AGENT: ActorRef = { id: "agent-session-1", kind: "agent" };

export const DEFAULT_SOURCE: SourceRef = {
  system: "manual",
  kind: "founder-entry",
  locator: "test",
};

export function makeService(): { service: ContextService; store: PersistencePort } {
  const store = createFixtureStore();
  const service = createContextService({
    store,
    clock: frozenClock(NOW),
    ids: sequentialIds("id"),
    founderActorId: FOUNDER.id,
    logger: silentLogger,
    defaultScope: "company",
    repoDomains: REPRESENTATIVE_REPO_DOMAINS,
  });
  return { service, store };
}

export function createInput(
  kind: CreateDirectiveInput["kind"],
  title: string,
  extras: Partial<CreateDirectiveInput> = {},
): CreateDirectiveInput {
  const input: CreateDirectiveInput = {
    kind,
    title,
    body: extras.body ?? `${title} body`,
    scope: extras.scope ?? "company",
    source: extras.source ?? DEFAULT_SOURCE,
    confidence: extras.confidence ?? 1,
  };
  if (extras.status !== undefined) {
    input.status = extras.status;
  }
  if (extras.effective_from !== undefined) {
    input.effective_from = extras.effective_from;
  }
  if (extras.expires_at !== undefined) {
    input.expires_at = extras.expires_at;
  }
  if (extras.supersedes !== undefined) {
    input.supersedes = extras.supersedes;
  }
  if (extras.observed_at !== undefined) {
    input.observed_at = extras.observed_at;
  }
  if (extras.freshness_status !== undefined) {
    input.freshness_status = extras.freshness_status;
  }
  if (extras.body !== undefined) {
    input.body = extras.body;
  }
  return input;
}
