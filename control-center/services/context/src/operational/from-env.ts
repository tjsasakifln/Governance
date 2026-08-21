import { isProductionEnv, databaseUrlFromEnv } from "../store/from-env.ts";
import { ServiceError } from "../errors.ts";
import { createFixtureOperationalPort, createUnavailableOperationalPort } from "./fixture.ts";
import { createPostgresOperationalPort } from "./postgres.ts";
import { representativeOperationalData } from "./representative.ts";
import type { OperationalReadPort } from "./port.ts";

export function createOperationalPortFromEnv(env: NodeJS.ProcessEnv): OperationalReadPort {
  const url = databaseUrlFromEnv(env);
  const fixture = (env.CONTEXT_OPERATIONAL_FIXTURE ?? env.CONTEXT_SERVICE_FIXTURE ?? "empty").trim() || "empty";
  if (fixture === "unavailable") {
    return createUnavailableOperationalPort();
  }
  if (url) {
    return createPostgresOperationalPort(url);
  }
  if (isProductionEnv(env)) {
    throw new ServiceError(
      "store_misconfigured",
      "DATABASE_URL is required in production; refusing operational fixture fallback.",
      500,
    );
  }
  if (fixture === "representative") {
    return createFixtureOperationalPort(representativeOperationalData());
  }
  if (fixture !== "empty") {
    throw new ServiceError("invalid_input", "CONTEXT_OPERATIONAL_FIXTURE must be representative, empty, or unavailable", 400);
  }
  return createFixtureOperationalPort();
}
