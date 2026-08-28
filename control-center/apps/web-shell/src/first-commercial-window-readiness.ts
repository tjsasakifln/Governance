export const FIRST_WINDOW_READINESS_FIELDS = [
  "governance_policy_ready",
  "control_center_readback_ready",
  "commercial_authority_observable",
  "source_health_observable",
  "reservoir_observable",
  "queue_observable",
  "transport_pause_observable",
  "kill_switch_observable",
  "mailbox_capacity_observable",
  "exceptions_operable",
  "cross_contract_version",
  "blocking_reasons",
  "decision",
] as const;

export type FirstWindowReadinessDecision = "READY_FOR_FINAL_CONVERGENCE" | "BLOCKED";

const FLAGS = [
  "governance_policy_ready",
  "control_center_readback_ready",
  "commercial_authority_observable",
  "source_health_observable",
  "reservoir_observable",
  "queue_observable",
  "transport_pause_observable",
  "kill_switch_observable",
  "mailbox_capacity_observable",
  "exceptions_operable",
] as const;

export interface FirstCommercialWindowReadiness {
  schema_version: "first-commercial-window-readiness.v1";
  governance_policy_ready: boolean;
  control_center_readback_ready: boolean;
  commercial_authority_observable: boolean;
  source_health_observable: boolean;
  reservoir_observable: boolean;
  queue_observable: boolean;
  transport_pause_observable: boolean;
  kill_switch_observable: boolean;
  mailbox_capacity_observable: boolean;
  exceptions_operable: boolean;
  cross_contract_version: string;
  blocking_reasons: string[];
  decision: FirstWindowReadinessDecision;
  smtp_authorized: false;
  provider_dispatch_authorized: false;
  first_window_go: false;
}

export function projectFirstCommercialWindowReadiness(
  observation: Record<string, unknown>,
): FirstCommercialWindowReadiness {
  const blocking: string[] = [];
  const flags: Record<(typeof FLAGS)[number], boolean> = {
    governance_policy_ready: false,
    control_center_readback_ready: false,
    commercial_authority_observable: false,
    source_health_observable: false,
    reservoir_observable: false,
    queue_observable: false,
    transport_pause_observable: false,
    kill_switch_observable: false,
    mailbox_capacity_observable: false,
    exceptions_operable: false,
  };
  for (const name of FLAGS) {
    const raw = observation[name];
    if (raw === true) flags[name] = true;
    else if (raw === false) {
      flags[name] = false;
      blocking.push(`${name.toUpperCase()}_ABSENT`);
    } else {
      flags[name] = false;
      blocking.push(`${name.toUpperCase()}_UNKNOWN`);
    }
  }
  let version = typeof observation.cross_contract_version === "string" && observation.cross_contract_version.trim()
    ? observation.cross_contract_version
    : "";
  if (!version) {
    version = "UNKNOWN";
    blocking.push("CROSS_CONTRACT_VERSION_UNKNOWN");
  }
  if (Array.isArray(observation.blocking_reasons)) {
    for (const item of observation.blocking_reasons) {
      if (typeof item === "string" && item) blocking.push(item);
    }
  }
  const unique = [...new Set(blocking)];
  return {
    schema_version: "first-commercial-window-readiness.v1",
    ...flags,
    cross_contract_version: version,
    blocking_reasons: unique,
    decision: unique.length === 0 ? "READY_FOR_FINAL_CONVERGENCE" : "BLOCKED",
    smtp_authorized: false,
    provider_dispatch_authorized: false,
    first_window_go: false,
  };
}
