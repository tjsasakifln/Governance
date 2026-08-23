/**
 * Minimum client identity on the Clientes surface.
 *
 * A record the producer could not identify is not a client. It used to reach
 * this surface as a card titled "Cliente" with scope `client:unknown` and every
 * system UNKNOWN — indistinguishable from a real entity and with no way to
 * correct it. Such a record is now kept out of the client list and published as
 * a data-quality / join-queue entry naming its origin, the reason it has no
 * identity, and the action that clears it.
 *
 * The queue itself is produced upstream (the collector's clients projector) and
 * carried on the snapshot as `data_quality.entries`. This module only supplies
 * the surface-side gate and the fallback entry for a *published client row* that
 * fails the rule — a case the producer, by construction, did not report.
 */
import {
  isIdentifiedClientSlug,
  isPlaceholderDisplayName,
} from "@confenge/control-center-contracts/ids";
import {
  CLIENT_IDENTITY_REQUIRED_ACTION,
  CLIENT_IDENTITY_REQUIRED_ACTIONS,
} from "@confenge/control-center-contracts/taxonomy";
import type { ClientIdentityException, ClientStatus, Provenance } from "./types";
import { ownMapValue } from "./own-map";

export { CLIENT_IDENTITY_REQUIRED_ACTION };

/** True only for a record that carries a usable client identity. */
export function isOperationalClient(item: ClientStatus): boolean {
  return (
    isIdentifiedClientSlug(item.client_slug) &&
    item.scope === `client:${item.client_slug}` &&
    !isPlaceholderDisplayName(item.display_name)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Build a queue entry for a published row that fails the identity rule.
 *
 * Origin is the row's own declared source, never the reader's base URL: saying
 * "control-center · http://…" would name whoever fetched the row rather than
 * whoever produced it.
 */
export function clientIdentityGapFrom(
  row: Record<string, unknown>,
  index: number,
  fallback: Provenance,
): ClientIdentityException {
  const slug = row.client_slug;
  const reasons: string[] = [];
  if (typeof slug !== "string" || slug.trim() === "") {
    reasons.push("missing_client_key");
  } else if (!isIdentifiedClientSlug(slug)) {
    reasons.push("reserved_placeholder_slug");
  } else if (typeof row.scope === "string" && row.scope !== `client:${slug}`) {
    reasons.push("unusable_client_key");
  }
  if (isPlaceholderDisplayName(row.display_name)) {
    reasons.push(typeof row.display_name === "string" ? "placeholder_display_name" : "missing_display_name");
  }
  if (reasons.length === 0) {
    reasons.push("unusable_client_key");
  }
  const first = reasons[0] as keyof typeof CLIENT_IDENTITY_REQUIRED_ACTIONS;
  const declaredSource = asRecord(asRecord(row.provenance)?.source);
  return {
    id: typeof row.id === "string" && row.id.trim() !== "" ? row.id : `client-identity:${index}`,
    source_id: typeof row.source_id === "string" ? row.source_id : null,
    kind: "client_identity_missing",
    why: reasons.map((code) => ownMapValue(REASON_TEXT, code) ?? "verificação de identidade não reconhecida").join("; "),
    reason_codes: reasons,
    recommended_next_action: ownMapValue(CLIENT_IDENTITY_REQUIRED_ACTIONS, first) ?? CLIENT_IDENTITY_REQUIRED_ACTION,
    status: "open",
    origin: declaredSource
      ? {
          system: String(declaredSource.system ?? fallback.source.system),
          kind: String(declaredSource.kind ?? fallback.source.kind),
          locator: String(declaredSource.locator ?? fallback.source.locator),
        }
      : { system: "origem não declarada", kind: "client-status", locator: "sem origem declarada" },
  };
}

const REASON_TEXT: Record<string, string> = {
  missing_client_key: "a linha publicada não traz chave de cliente",
  unusable_client_key: "a identidade publicada é inconsistente (scope e client_slug não batem)",
  reserved_placeholder_slug: "o identificador publicado é um placeholder reservado, não uma identidade",
  missing_display_name: "a linha publicada não traz nome de cliente",
  placeholder_display_name: "o nome publicado é um placeholder, não uma identidade",
};
