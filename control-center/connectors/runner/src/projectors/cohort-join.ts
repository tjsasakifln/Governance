import { asArray, asRecord } from "./types.ts";

const DEAL_JOIN_KEYS = ["contact_id", "account_id", "lead_id"] as const;

function addId(ids: Set<string>, value: unknown): void {
  if (typeof value === "string" && value.trim().length > 0) {
    ids.add(value.trim());
  }
}

/** Durable identifiers that prove a CRM contact is a cohort member. Never display name. */
export function contactDurableIds(contact: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  addId(ids, contact.id);
  addId(ids, contact.contact_id);
  addId(ids, contact.account_id);
  addId(ids, contact.lead_id);
  const account = asRecord(contact.account);
  if (account) addId(ids, account.id);
  const lead = asRecord(contact.lead);
  if (lead) addId(ids, lead.id);
  return ids;
}

/**
 * Durable identifiers that prove a deal belongs to a contact/account/lead.
 * Deal id itself is not join evidence to a contact.
 */
export function dealDurableIds(deal: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  for (const key of DEAL_JOIN_KEYS) {
    addId(ids, deal[key]);
  }
  const contact = asRecord(deal.contact);
  if (contact) addId(ids, contact.id);
  const account = asRecord(deal.account);
  if (account) addId(ids, account.id);
  const lead = asRecord(deal.lead);
  if (lead) addId(ids, lead.id);
  for (const item of asArray(deal.contacts)) {
    const rec = asRecord(item);
    if (!rec) continue;
    addId(ids, rec.id);
    addId(ids, rec.contact_id);
  }
  return ids;
}

export function dealHasJoinEvidence(deal: Record<string, unknown>): boolean {
  return dealDurableIds(deal).size > 0;
}

export function dealBelongsToMembers(deal: Record<string, unknown>, memberIds: Set<string>): boolean {
  if (memberIds.size === 0) return false;
  for (const id of dealDurableIds(deal)) {
    if (memberIds.has(id)) return true;
  }
  return false;
}

export function uniqueById(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : null;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(row);
  }
  return out;
}

export const JOIN_UNPROVEN = "JOIN_UNPROVEN" as const;
export const JOIN_UNPROVEN_REASON = "durable_contact_to_deal_join_unavailable" as const;

/**
 * Join is available when every observed deal that could affect conversion
 * carries a durable identifier, or when there are no deals (honest zero).
 */
export function cohortJoinAvailable(
  contacts: Record<string, unknown>[],
  deals: Record<string, unknown>[],
): boolean {
  if (deals.length === 0) return true;
  if (!deals.some(dealHasJoinEvidence)) return false;
  if (contacts.length > 0) {
    const memberIds = new Set<string>();
    for (const contact of contacts) {
      for (const id of contactDurableIds(contact)) memberIds.add(id);
    }
    if (memberIds.size === 0) return false;
  }
  return deals.every(dealHasJoinEvidence);
}

export function attributedDeals(
  contacts: Record<string, unknown>[],
  deals: Record<string, unknown>[],
): Record<string, unknown>[] {
  const memberIds = new Set<string>();
  for (const contact of contacts) {
    for (const id of contactDurableIds(contact)) memberIds.add(id);
  }
  return uniqueById(deals.filter((deal) => dealBelongsToMembers(deal, memberIds)));
}
