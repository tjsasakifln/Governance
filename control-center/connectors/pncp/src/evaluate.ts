import { createPncpContractAdapter } from "./adapter.js";
import { mapUpstreamStatus } from "./map.js";
import { parsePncpContract } from "./parse.js";
import { projectFailure, projectSuccess } from "./project.js";
import type {
  AdapterConfig,
  EvaluationContext,
  PncpFreshnessEvaluation,
} from "./types.js";

/**
 * Pure parse → map → project. I/O stays in the adapter.
 * extra-cli UNKNOWN stays UNKNOWN; transport/parser/version failure is ERROR.
 */
export function evaluatePncpContractPayload(
  payload: unknown,
  ctx: EvaluationContext,
): PncpFreshnessEvaluation {
  const parsed = parsePncpContract(payload);
  if (!parsed.ok) {
    return projectFailure(ctx, parsed.error, {
      contract_version: parsed.contract_version,
    });
  }
  const mapping = mapUpstreamStatus(parsed.contract.status);
  return projectSuccess(parsed.contract, mapping, ctx);
}

/**
 * Shipped evaluation path: READ-ONLY adapter → parse → map → project.
 */
export async function evaluatePncpFreshness(
  config: AdapterConfig,
): Promise<PncpFreshnessEvaluation> {
  const adapter = createPncpContractAdapter(config);
  const read = await adapter.read();
  const ctx: EvaluationContext = {
    adapterKind: read.kind,
    locator: read.locator,
    collectedAt: read.observedAt,
  };
  if (!read.ok) {
    return projectFailure(ctx, read.error);
  }
  return evaluatePncpContractPayload(read.payload, ctx);
}
