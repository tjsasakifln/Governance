import { projectCommercial } from "./commercial.ts";
import { projectEngineering } from "./engineering.ts";
import { projectFinance } from "./finance.ts";
import { projectClientsFromCommercial, projectInfrastructure, projectPncp } from "./rest.ts";
import { PROJECTOR_VERSION, type CollectorEnvelope, type ProjectedSnapshot } from "./types.ts";

export { PROJECTOR_VERSION, CONFENGE_OPERATIONAL_REPOS, AVAILABILITY } from "./types.ts";
export type { Availability, ProjectedSnapshot, CollectorEnvelope } from "./types.ts";
export { availabilityFromEnvelope } from "./availability.ts";

export function projectCollector(envelope: CollectorEnvelope): ProjectedSnapshot[] {
  const name = envelope.collector.toLowerCase();
  if (name.includes("warmbly") || name === "commercial") {
    const commercial = projectCommercial(envelope);
    return [commercial, projectClientsFromCommercial(commercial)];
  }
  if (name.includes("asaas") || name === "finance") {
    return [projectFinance(envelope)];
  }
  if (name.includes("github") || name === "engineering") {
    return projectEngineering(envelope);
  }
  if (name.includes("infra")) {
    return [projectInfrastructure(envelope)];
  }
  if (name.includes("pncp")) {
    return [projectPncp(envelope)];
  }
  return [];
}
