import {
  COMMERCIAL_SURFACES,
  DESTINATIONS,
  WARMBLY_SURFACES,
  getDestination,
} from "./destinations";

export const VISUAL_GATE_SCHEMA = "control-center.visual-gate.v1" as const;

export interface VisualRoute {
  readonly key: string;
  readonly hash: string;
  readonly label: string;
  readonly kind: "destination" | "surface";
}

/**
 * Browser-gate inventory derived from the exact registries used by navigation.
 * A new destination or registered sub-surface therefore enters the visual
 * matrix without somebody remembering to edit a Playwright script.
 */
export function registeredVisualRoutes(): readonly VisualRoute[] {
  const destinationRoutes: readonly VisualRoute[] = DESTINATIONS.map((destination) => ({
    key: `destination:${destination.id}`,
    hash: destination.path,
    label: destination.label,
    kind: "destination",
  }));
  const commercialRoot = getDestination("comercial").path;
  const commercialRoutes: readonly VisualRoute[] = COMMERCIAL_SURFACES.map((surface) => ({
    key: `commercial:${surface}`,
    hash: `${commercialRoot}/${surface}`,
    label: `Comercial / ${surface}`,
    kind: "surface",
  }));
  const warmblyRoot = getDestination("warmbly").path;
  const warmblyRoutes: readonly VisualRoute[] = WARMBLY_SURFACES.map((surface) => ({
    key: `warmbly:${surface}`,
    hash: `${warmblyRoot}/${surface}`,
    label: `Operação Warmbly / ${surface}`,
    kind: "surface",
  }));
  return [...destinationRoutes, ...commercialRoutes, ...warmblyRoutes];
}

export const VISUAL_GATE_VIEWPORTS = [
  { id: "390", width: 390, height: 844 },
  { id: "tablet-768", width: 768, height: 1024 },
  { id: "desktop-1440", width: 1440, height: 1000 },
] as const;

export const VISUAL_GATE_STATES = [
  "ready",
  "loading",
  "empty",
  "stale",
  "error",
] as const;

export function visualMatrixConsistencyErrors(): readonly string[] {
  const errors: string[] = [];
  const routes = registeredVisualRoutes();
  if (new Set(routes.map((route) => route.key)).size !== routes.length) {
    errors.push("Visual route keys are not unique.");
  }
  if (new Set(routes.map((route) => route.hash)).size !== routes.length) {
    errors.push("Visual route hashes are not unique.");
  }
  for (const route of routes) {
    if (!route.hash.startsWith("#/")) {
      errors.push(`Visual route ${route.key} is not a hash route.`);
    }
  }
  return errors;
}
