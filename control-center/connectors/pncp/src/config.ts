import type { FreshnessThresholds } from "./types.js";

export const DEFAULT_THRESHOLDS: FreshnessThresholds = {
  lastSuccessSlaHours: 24,
  dataSlaHours: 24,
  recentWindowHours: 24,
  minRecentWindowCount: 1,
  consecutiveErrorThreshold: 3,
  collectorAliveMaxAgeHours: 1,
  deadPipelineMaxAgeHours: 72,
};

function envInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid integer env ${name}`);
  }
  return parsed;
}

/** Thresholds from env with documented defaults. Invalid values fail closed. */
export function loadThresholdsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): FreshnessThresholds {
  return {
    lastSuccessSlaHours: envInt(
      env,
      "PNCP_FRESHNESS_SLA_HOURS",
      DEFAULT_THRESHOLDS.lastSuccessSlaHours,
    ),
    dataSlaHours: envInt(env, "PNCP_DATA_SLA_HOURS", DEFAULT_THRESHOLDS.dataSlaHours),
    recentWindowHours: envInt(
      env,
      "PNCP_RECENT_WINDOW_HOURS",
      DEFAULT_THRESHOLDS.recentWindowHours,
    ),
    minRecentWindowCount: envInt(
      env,
      "PNCP_MIN_RECENT_WINDOW_COUNT",
      DEFAULT_THRESHOLDS.minRecentWindowCount,
    ),
    consecutiveErrorThreshold: envInt(
      env,
      "PNCP_CONSECUTIVE_ERROR_THRESHOLD",
      DEFAULT_THRESHOLDS.consecutiveErrorThreshold,
    ),
    collectorAliveMaxAgeHours: envInt(
      env,
      "PNCP_COLLECTOR_ALIVE_MAX_AGE_HOURS",
      DEFAULT_THRESHOLDS.collectorAliveMaxAgeHours,
    ),
    deadPipelineMaxAgeHours: envInt(
      env,
      "PNCP_DEAD_PIPELINE_MAX_AGE_HOURS",
      DEFAULT_THRESHOLDS.deadPipelineMaxAgeHours,
    ),
  };
}

export const ENV_VAR_DOCS = [
  "PNCP_METRICS_KIND=health_artifact|http_api|db_view",
  "PNCP_METRICS_ARTIFACT_PATH=<path to JSON health artifact>",
  "PNCP_METRICS_HTTP_URL=<read-only metrics URL>",
  "PNCP_FRESHNESS_SLA_HOURS (default 24)",
  "PNCP_DATA_SLA_HOURS (default 24)",
  "PNCP_RECENT_WINDOW_HOURS (default 24)",
  "PNCP_MIN_RECENT_WINDOW_COUNT (default 1)",
  "PNCP_CONSECUTIVE_ERROR_THRESHOLD (default 3)",
  "PNCP_COLLECTOR_ALIVE_MAX_AGE_HOURS (default 1)",
  "PNCP_DEAD_PIPELINE_MAX_AGE_HOURS (default 72)",
] as const;
