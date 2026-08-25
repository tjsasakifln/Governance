export interface VisualGateSummary {
  readonly routes: number;
  readonly axe: number;
  readonly geometry: number;
}

export function assertVisualGateManifest(
  manifest: unknown,
  expectedRuntimeSha: string,
): VisualGateSummary;

