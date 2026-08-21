import { ServiceError } from "../errors.ts";
import { createFixtureStore } from "./fixture.ts";
import { createPostgresStore, type PostgresStore } from "./postgres.ts";
import type { PersistencePort } from "./adapter.ts";

export function isProductionEnv(env: NodeJS.ProcessEnv): boolean {
  const nodeEnv = (env.NODE_ENV ?? "").trim().toLowerCase();
  const ccEnv = (env.CONTROL_CENTER_ENV ?? "").trim().toLowerCase();
  return nodeEnv === "production" || ccEnv === "production";
}

export function databaseUrlFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.DATABASE_URL ?? env.CONTROL_CENTER_DATABASE_URL;
  if (!raw || raw.trim() === "") {
    return undefined;
  }
  return raw.trim();
}

/**
 * Synchronous store factory. DATABASE_URL refuses the in-memory fixture.
 * Production boot uses `createStoreFromEnvAsync`.
 */
export function createStoreFromEnv(env: NodeJS.ProcessEnv): PersistencePort {
  if (databaseUrlFromEnv(env)) {
    throw new ServiceError(
      "store_misconfigured",
      "DATABASE_URL is set; use createStoreFromEnvAsync for the Postgres adapter. Refusing fixture fallback.",
      500,
    );
  }
  if (isProductionEnv(env)) {
    throw new ServiceError(
      "store_misconfigured",
      "DATABASE_URL is required in production; refusing fixture fallback.",
      500,
    );
  }
  return createFixtureStore();
}

export async function createStoreFromEnvAsync(
  env: NodeJS.ProcessEnv,
): Promise<{ store: PersistencePort; storeName: "postgres" | "fixture" }> {
  const url = databaseUrlFromEnv(env);
  if (url) {
    const store: PostgresStore = await createPostgresStore(url);
    return { store, storeName: "postgres" };
  }
  if (isProductionEnv(env)) {
    throw new ServiceError(
      "store_misconfigured",
      "DATABASE_URL is required in production; refusing fixture fallback.",
      500,
    );
  }
  return { store: createFixtureStore(), storeName: "fixture" };
}
