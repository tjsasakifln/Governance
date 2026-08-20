import { initialUiState, type AppSession } from "../src/app-state.ts";
import { frozenClock } from "../src/datetime.ts";
import { resetIdSeq } from "../src/ids.ts";
import { FIXTURE_DIRECTIVES, FIXTURE_NOW } from "../src/fixtures.ts";
import { createMockService } from "../src/service.ts";
import { MemoryDirectiveStore } from "../src/store.ts";
import type { IdentityEnv } from "../src/actor.ts";
import type { CreateDirectiveInput, DirectiveKind } from "../src/types.ts";

export function makeSession(env?: IdentityEnv): AppSession {
  resetIdSeq();
  const service = createMockService({
    store: new MemoryDirectiveStore(FIXTURE_DIRECTIVES),
    clock: frozenClock(FIXTURE_NOW),
    ...(env ? { env } : {}),
  });
  return { service, ui: initialUiState(service) };
}

export function createInput(
  kind: DirectiveKind,
  title: string,
  extra: Partial<CreateDirectiveInput> = {},
): CreateDirectiveInput {
  return {
    kind,
    kindConfirm: extra.kindConfirm ?? kind,
    title,
    body: extra.body ?? `Body for ${title}`,
    scope: extra.scope ?? "company",
    status: extra.status ?? "active",
    effective_from: extra.effective_from ?? "2026-08-20T15:00:00Z",
    expires_at: extra.expires_at === undefined ? null : extra.expires_at,
    supersedes: extra.supersedes === undefined ? null : extra.supersedes,
    ...(extra.tags ? { tags: extra.tags } : {}),
  };
}
