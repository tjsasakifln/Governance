import { FORBIDDEN_SECRET_KEY_REGEX } from "./taxonomy.js";
import { isUtcDateTime } from "./datetime.js";
import { isMoney } from "./money.js";
import { isFreshnessStatus } from "./freshness.js";
import { FIXTURE_NAMES, type HojePayload, type Provenance } from "./types.js";

function assertNoSecretKeys(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoSecretKeys(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_KEY_REGEX.test(key)) {
      throw new Error(`Forbidden secret-shaped key at ${path}.${key}`);
    }
    assertNoSecretKeys(child, `${path}.${key}`);
  }
}

export function assertProvenance(p: Provenance, path: string): void {
  if (!p || typeof p !== "object") {
    throw new Error(`${path} provenance is required`);
  }
  if (!p.source || typeof p.source.system !== "string" || p.source.system.length === 0) {
    throw new Error(`${path} source.system is required`);
  }
  if (typeof p.source.kind !== "string" || p.source.kind.length === 0) {
    throw new Error(`${path} source.kind is required`);
  }
  if (typeof p.source.locator !== "string" || p.source.locator.length === 0) {
    throw new Error(`${path} source.locator is required`);
  }
  if (!isUtcDateTime(p.observed_at)) {
    throw new Error(`${path} observed_at must be UTC RFC3339 with Z`);
  }
  if (!isFreshnessStatus(p.freshness_status)) {
    throw new Error(`${path} freshness_status is invalid`);
  }
  if (p.confidence !== undefined && (p.confidence < 0 || p.confidence > 1)) {
    throw new Error(`${path} confidence must be in [0, 1]`);
  }
}

export function validatePayload(payload: HojePayload): HojePayload {
  if (payload.schema_version !== "control-center.hoje-payload.v1") {
    throw new Error("unsupported schema_version");
  }
  if (!(FIXTURE_NAMES as readonly string[]).includes(payload.fixture_name)) {
    throw new Error(`unknown fixture_name: ${payload.fixture_name}`);
  }
  if (!isUtcDateTime(payload.generated_at)) {
    throw new Error("generated_at must be UTC RFC3339 with Z");
  }
  assertNoSecretKeys(payload, "payload");
  for (const action of payload.recommended_actions) {
    assertProvenance(action.provenance, action.id);
  }
  for (const item of payload.incidents) {
    assertProvenance(item.provenance, item.id);
  }
  for (const client of payload.clients) {
    assertProvenance(client.provenance, client.id);
    if (client.open_receivables && !isMoney(client.open_receivables)) {
      throw new Error(`${client.id} open_receivables must be integer cents + ISO currency`);
    }
  }
  if (payload.commercial) {
    assertProvenance(payload.commercial.provenance, payload.commercial.id);
  }
  if (payload.finance) {
    assertProvenance(payload.finance.provenance, payload.finance.id);
    if (!isMoney(payload.finance.receivables_open) || !isMoney(payload.finance.receivables_overdue)) {
      throw new Error("finance money must be integer cents + ISO currency");
    }
  }
  if (payload.engineering) {
    assertProvenance(payload.engineering.provenance, payload.engineering.id);
  }
  for (const svc of payload.infra) {
    assertProvenance(svc.provenance, svc.id);
  }
  for (const agent of payload.agent_activity) {
    if (!isUtcDateTime(agent.observed_at)) {
      throw new Error(`${agent.correlation_id} observed_at must be UTC RFC3339 with Z`);
    }
    if (!isFreshnessStatus(agent.freshness_status)) {
      throw new Error(`${agent.correlation_id} freshness_status is invalid`);
    }
  }
  return payload;
}
