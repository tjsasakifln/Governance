import { OPERATIONAL_DOMAINS, OPERATIONAL_HTTP_PATHS, OPERATIONAL_VIEWS } from "./operational-envelope.js";

export const OPERATIONAL_GET_ROUTES = [
  { method: "GET", path: "/v1/operational-snapshots", query: ["scope"] },
  { method: "GET", path: "/v1/domains/:domain", query: ["scope"], params: ["domain"] },
  {
    method: "GET",
    path: "/v1/domains/commercial/lists/:list",
    query: ["scope", "q", "estado", "tipo", "origem", "responsavel", "prioridade", "periodo", "ordem", "pagina", "por_pagina"],
    params: ["list"],
  },
  { method: "GET", path: "/v1/attention", query: ["scope", "horizon"] },
  { method: "GET", path: "/v1/today", query: ["scope"] },
  { method: "GET", path: "/v1/source-observations", query: ["scope", "source"] },
] as const;

export const OPERATIONAL_HORIZONS = ["now", "today"] as const;
export type OperationalHorizon = (typeof OPERATIONAL_HORIZONS)[number];

export const CONTEXT_PATH_UNCHANGED = "/v1/context";

export { OPERATIONAL_DOMAINS, OPERATIONAL_HTTP_PATHS, OPERATIONAL_VIEWS };
