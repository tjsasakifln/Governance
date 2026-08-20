import { createPncpMetricsAdapter } from "./adapter.js";
import { classifyPncpFreshness } from "./classify.js";
import { loadThresholdsFromEnv } from "./config.js";
import { projectPncpHealth } from "./project.js";
import type {
  AdapterConfig,
  FreshnessThresholds,
  PncpFreshnessEvaluation,
} from "./types.js";

/**
 * Shipped evaluation path: adapter → parse/normalize → classify → project.
 */
export async function evaluatePncpFreshness(
  config: AdapterConfig,
  thresholds: FreshnessThresholds = loadThresholdsFromEnv(),
): Promise<PncpFreshnessEvaluation> {
  const adapter = createPncpMetricsAdapter(config);
  const { snapshot, now } = await adapter.read();
  const classification = classifyPncpFreshness(snapshot, thresholds, now);
  const { serviceHealth, sourceObservation } = projectPncpHealth(
    snapshot,
    classification,
    thresholds,
  );
  return {
    snapshot,
    classification,
    serviceHealth,
    sourceObservation,
    thresholds,
  };
}
