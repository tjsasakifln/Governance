import type { EndpointFailure, WarmblyPayload } from "../contracts/warmbly-payload.ts";
import {
  CircuitOpenError,
  MethodNotAllowedError,
  TimeoutError,
  type WarmblyClient,
} from "../http/client.ts";
import { COLLECT_ROUTES } from "./routes.ts";

export type FetchResult = {
  payload: WarmblyPayload;
  api_version?: string;
};

function asPayloadValue(json: unknown): unknown {
  return json;
}

export async function fetchWarmblyPayload(client: WarmblyClient): Promise<FetchResult> {
  const payload: WarmblyPayload = { unavailable: [] };
  let apiVersion: string | undefined;

  for (const route of COLLECT_ROUTES) {
    try {
      const res = await client.request({
        method: route.method,
        path: route.path,
        body: route.body,
      });
      if (res.api_version) {
        apiVersion = res.api_version;
      }
      if (res.status === 404 || res.status === 501) {
        const failure: EndpointFailure = {
          method: route.method,
          path: route.path.split("?")[0] ?? route.path,
          status: res.status,
          reason: `Warmbly returned ${res.status} for ${route.method} ${route.path}`,
        };
        payload.unavailable = [...(payload.unavailable ?? []), failure];
        continue;
      }
      if (!res.ok) {
        const failure: EndpointFailure = {
          method: route.method,
          path: route.path.split("?")[0] ?? route.path,
          status: res.status,
          reason: `Warmbly returned ${res.status} for ${route.method} ${route.path}`,
        };
        payload.unavailable = [...(payload.unavailable ?? []), failure];
        continue;
      }
      assignRoute(payload, route.key, asPayloadValue(res.json));
    } catch (err) {
      if (err instanceof MethodNotAllowedError) {
        throw err;
      }
      const status =
        err instanceof TimeoutError ? 598 : err instanceof CircuitOpenError ? 599 : 500;
      const failure: EndpointFailure = {
        method: route.method,
        path: route.path.split("?")[0] ?? route.path,
        status,
        reason: err instanceof Error ? err.message : "fetch failed",
      };
      payload.unavailable = [...(payload.unavailable ?? []), failure];
      if (err instanceof CircuitOpenError) {
        break;
      }
    }
  }

  if (apiVersion) {
    payload.api_version = apiVersion;
  }
  return { payload, api_version: apiVersion };
}

function assignRoute(payload: WarmblyPayload, key: CollectRouteKey, json: unknown): void {
  switch (key) {
    case "health":
      payload.health = asRecord(json) as WarmblyPayload["health"];
      break;
    case "pipelines":
      payload.pipelines = json as WarmblyPayload["pipelines"];
      break;
    case "deals":
      payload.deals = json as WarmblyPayload["deals"];
      break;
    case "deals_summary":
      payload.deals_summary = unwrapMaybeData(json) as WarmblyPayload["deals_summary"];
      break;
    case "tasks":
      payload.tasks = json as WarmblyPayload["tasks"];
      break;
    case "tasks_search":
      payload.tasks_search = json as WarmblyPayload["tasks_search"];
      break;
    case "contacts":
      payload.contacts = json as WarmblyPayload["contacts"];
      break;
    case "campaigns":
      payload.campaigns = json as WarmblyPayload["campaigns"];
      break;
    case "campaigns_overview":
      payload.campaigns_overview = json as WarmblyPayload["campaigns_overview"];
      break;
    case "unibox_overview":
      payload.unibox_overview = json as WarmblyPayload["unibox_overview"];
      break;
    case "confenge_status":
      payload.confenge_status = json as WarmblyPayload["confenge_status"];
      break;
    case "confenge_ops_health":
      payload.confenge_ops_health = json as WarmblyPayload["confenge_ops_health"];
      break;
    case "confenge_attention":
      payload.confenge_attention = json as WarmblyPayload["confenge_attention"];
      break;
    case "confenge_today":
      payload.confenge_today = json as WarmblyPayload["confenge_today"];
      break;
    case "confenge_inbound":
      payload.confenge_inbound = json as WarmblyPayload["confenge_inbound"];
      break;
    default:
      break;
  }
}

type CollectRouteKey = (typeof COLLECT_ROUTES)[number]["key"];

function asRecord(json: unknown): Record<string, unknown> {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    return json as Record<string, unknown>;
  }
  return {};
}

function unwrapMaybeData(json: unknown): unknown {
  if (json && typeof json === "object" && "data" in json) {
    return (json as { data: unknown }).data;
  }
  return json;
}
