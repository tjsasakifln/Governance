import type { OperationalReadResult } from "./types.ts";

/**
 * Read port over the frozen Goal 03 views. Production SELECTs those names.
 * Tests use a fixture/contract adapter. The request path MUST NOT call
 * GitHub, Warmbly, Asaas, PNCP, or host infra.
 */
export interface OperationalReadPort {
  readLatest(): Promise<OperationalReadResult>;
}

export const OPERATIONAL_READ_CONTRACT_VERSION = "control-center.operational-read.v1";
