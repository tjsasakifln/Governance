/**
 * Minimum client identity, applied on the Clientes rendering path.
 *
 * A record the pipeline could not identify is not a client. It used to reach
 * this surface as a card titled "Cliente" with scope `client:unknown` and every
 * system UNKNOWN — indistinguishable from a real entity and with no way to
 * correct it. Such a record is now split out of the client list and rendered as
 * a data-quality / join-queue entry that names its origin, the reason it has no
 * identity, and the action that clears it.
 */
import {
  isIdentifiedClientSlug,
  isPlaceholderDisplayName,
} from "@confenge/control-center-contracts/ids";
import { CLIENT_IDENTITY_REQUIRED_ACTION } from "@confenge/control-center-contracts/taxonomy";
import type { ClientStatus } from "./types";

export { CLIENT_IDENTITY_REQUIRED_ACTION };

export interface ClientIdentityGap {
  readonly client: ClientStatus;
  readonly origin: string;
  readonly reasons: readonly string[];
  readonly required_action: string;
}

/** True only for a record that carries a usable client identity. */
export function isOperationalClient(item: ClientStatus): boolean {
  return (
    isIdentifiedClientSlug(item.client_slug) &&
    item.scope === `client:${item.client_slug}` &&
    !isPlaceholderDisplayName(item.display_name)
  );
}

function originOf(item: ClientStatus): string {
  const system = item.provenance?.source?.system;
  const locator = item.provenance?.source?.locator;
  if (system && locator) return `${system} · ${locator}`;
  if (system) return system;
  return "origem não declarada";
}

/** Why this record has no identity. Reason codes rendered as operator-readable text. */
export function identityGapOf(item: ClientStatus): ClientIdentityGap {
  const reasons: string[] = [];
  if (!isIdentifiedClientSlug(item.client_slug)) {
    reasons.push(`identificador ausente ou reservado (client_slug="${item.client_slug}")`);
  } else if (item.scope !== `client:${item.client_slug}`) {
    reasons.push(`scope "${item.scope}" não corresponde a client:${item.client_slug}`);
  }
  if (isPlaceholderDisplayName(item.display_name)) {
    reasons.push(`nome é um placeholder ("${item.display_name}")`);
  }
  if (reasons.length === 0) {
    reasons.push("identidade mínima não comprovada");
  }
  return {
    client: item,
    origin: originOf(item),
    reasons,
    required_action: CLIENT_IDENTITY_REQUIRED_ACTION,
  };
}

/** Split a client list into publishable clients and the data-quality queue. */
export function partitionClients(rows: readonly ClientStatus[]): {
  clients: ClientStatus[];
  gaps: ClientIdentityGap[];
} {
  const clients: ClientStatus[] = [];
  const gaps: ClientIdentityGap[] = [];
  for (const row of rows) {
    if (isOperationalClient(row)) {
      clients.push(row);
    } else {
      gaps.push(identityGapOf(row));
    }
  }
  return { clients, gaps };
}
