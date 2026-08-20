import { ServiceError } from "../errors.ts";
import { createFixtureStore } from "./fixture.ts";
import type { PersistenceAdapter } from "./adapter.ts";

/**
 * DATABASE_URL, if present, means the operator expects PostgreSQL.
 * This workstream does not own that database. Fail closed rather than
 * silently serving the in-memory fixture.
 */
export function createStoreFromEnv(env: NodeJS.ProcessEnv): PersistenceAdapter {
  if (env.DATABASE_URL && env.DATABASE_URL.trim() !== "") {
    throw new ServiceError(
      "store_misconfigured",
      "DATABASE_URL is set; wire control-center/persistence at convergence. Refusing fixture fallback.",
      500,
    );
  }
  return createFixtureStore();
}
