import { fetchWarmblyPayload } from "./collector/fetch.ts";
import type { CommercialSnapshot } from "./contracts/snapshot.ts";
import type { WarmblyPayload } from "./contracts/warmbly-payload.ts";
import { WarmblyClient, type WarmblyClientOptions } from "./http/client.ts";
import {
  attentionSlice,
  collectFromWarmblyPayload,
  type NormalizeOptions,
} from "./mapper/normalize.ts";

export type CollectOptions = NormalizeOptions & {
  client?: WarmblyClient;
  clientOptions?: WarmblyClientOptions;
};

/**
 * Shipped collect entry: fetch Warmbly commercial reads (or accept a fixture
 * payload) and normalize into CommercialSnapshot + observations.
 *
 * Tests should call this function (or collectFromWarmblyPayload) — not a
 * reimplementation of mapping.
 */
export async function collect(opts: CollectOptions = {}): Promise<CommercialSnapshot> {
  if (!opts.client && !opts.clientOptions) {
    throw new Error("collect requires a WarmblyClient or clientOptions");
  }
  const client = opts.client ?? new WarmblyClient(opts.clientOptions as WarmblyClientOptions);
  const { payload, api_version } = await fetchWarmblyPayload(client);
  if (api_version && !payload.api_version) {
    payload.api_version = api_version;
  }
  return collectFromWarmblyPayload(payload, { now: opts.now });
}

export function collectFromFixture(
  payload: WarmblyPayload,
  opts: NormalizeOptions = {},
): CommercialSnapshot {
  return collectFromWarmblyPayload(payload, opts);
}

export {
  attentionSlice,
  collectFromWarmblyPayload,
  WarmblyClient,
};
export type { CommercialSnapshot, WarmblyPayload };
