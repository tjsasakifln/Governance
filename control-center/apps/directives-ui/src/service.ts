import { assertCanMutate, type IdentityEnv, resolveIdentity } from "./actor.ts";
import { isForbiddenMutation } from "./contract.ts";
import { buildDirective, type CreateDraft, defaultCreateDraft, draftToInput } from "./create.ts";
import { frozenClock, systemClock, toUtcDateTime } from "./datetime.ts";
import { DirectiveUiError } from "./errors.ts";
import { EMPTY_FILTER, filterDirectives } from "./filter.ts";
import { FIXTURE_DIRECTIVES, FIXTURE_NOW } from "./fixtures.ts";
import { logEvent } from "./log.ts";
import { observeDirective } from "./observe.ts";
import { previewAgentContext } from "./preview.ts";
import { MemoryDirectiveStore } from "./store.ts";
import { supersedeDirective } from "./supersede.ts";
import type {
  AgentScopePreview,
  Clock,
  CreateDirectiveInput,
  Directive,
  DirectiveFilter,
  ObservedDirective,
  ResourceId,
  SessionIdentity,
} from "./types.ts";

/**
 * Local mock port. Later convergence replaces this class with HTTP to
 * `control-center/services/context` while keeping the same method names.
 */
export interface DirectiveMemoryPort {
  readonly mode: "mock" | "http";
  list(filter?: DirectiveFilter): Directive[];
  get(id: ResourceId): Directive | undefined;
  create(input: CreateDirectiveInput): Directive;
  createFromDraft(draft: CreateDraft): Directive;
  supersede(predecessorId: ResourceId, input: CreateDirectiveInput): {
    predecessor: Directive;
    successor: Directive;
  };
  preview(scope: string): AgentScopePreview;
  identity(): SessionIdentity;
  newDraft(): CreateDraft;
  refusesForbiddenMutation(action: string): boolean;
}

export interface ServiceOptions {
  store?: MemoryDirectiveStore;
  clock?: Clock;
  identity?: SessionIdentity;
  env?: IdentityEnv;
}

export class MockDirectiveService implements DirectiveMemoryPort {
  readonly mode = "mock" as const;
  private readonly store: MemoryDirectiveStore;
  private readonly clock: Clock;
  private readonly session: SessionIdentity;

  constructor(options: ServiceOptions = {}) {
    this.store = options.store ?? new MemoryDirectiveStore(FIXTURE_DIRECTIVES);
    this.clock = options.clock ?? frozenClock(FIXTURE_NOW);
    this.session = options.identity ?? resolveIdentity(options.env ?? {});
  }

  identity(): SessionIdentity {
    return this.session;
  }

  list(filter: DirectiveFilter = EMPTY_FILTER): Directive[] {
    return filterDirectives(this.store.list(), filter);
  }

  get(id: ResourceId): Directive | undefined {
    return this.store.get(id);
  }

  observe(id: ResourceId): ObservedDirective | undefined {
    const record = this.store.get(id);
    if (!record) return undefined;
    return observeDirective(record, toUtcDateTime(this.clock.now()));
  }

  create(input: CreateDirectiveInput): Directive {
    assertCanMutate(this.session);
    const record = buildDirective(input, this.session.actor, this.clock);
    this.store.insert(record);
    logEvent("directive.create", {
      id: record.id,
      kind: record.kind,
      scope: record.scope,
      status: record.status,
    });
    return record;
  }

  createFromDraft(draft: CreateDraft): Directive {
    return this.create(draftToInput(draft));
  }

  supersede(predecessorId: ResourceId, input: CreateDirectiveInput): {
    predecessor: Directive;
    successor: Directive;
  } {
    assertCanMutate(this.session);
    const current = this.store.get(predecessorId);
    if (!current) {
      throw new DirectiveUiError("not_found", "predecessor does not exist", { id: predecessorId });
    }
    const result = supersedeDirective(current, input, this.session.actor, this.clock);
    this.store.replace(result.predecessor);
    this.store.insert(result.successor);
    logEvent("directive.supersede", {
      predecessor_id: result.predecessor.id,
      successor_id: result.successor.id,
      kind: result.successor.kind,
      scope: result.successor.scope,
    });
    return result;
  }

  preview(scope: string): AgentScopePreview {
    return previewAgentContext(this.store.list(), scope, this.clock);
  }

  newDraft(): CreateDraft {
    return defaultCreateDraft(this.clock.now());
  }

  refusesForbiddenMutation(action: string): boolean {
    return isForbiddenMutation(action);
  }
}

export function createMockService(options: ServiceOptions = {}): MockDirectiveService {
  return new MockDirectiveService(options);
}

export function createLiveClockService(env: IdentityEnv): MockDirectiveService {
  return new MockDirectiveService({
    clock: systemClock(),
    env,
    store: new MemoryDirectiveStore(FIXTURE_DIRECTIVES),
  });
}
