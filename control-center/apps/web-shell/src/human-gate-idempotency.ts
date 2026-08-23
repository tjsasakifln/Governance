/**
 * Keeps an uncertain human-gate intent on the same idempotency key across
 * retries, reloads and tabs. Only a compact hash and generation are persisted;
 * reasons, candidate data and message content never enter browser storage.
 */

export interface HumanGateIntent {
  action: "create" | "reproduce" | "validate" | "review" | "decide" | "adjust";
  version_id?: string;
  candidate_id?: string;
  limit?: number;
  decision?: "GO" | "NO_GO" | "APPROVE" | "REJECT" | "HOLD";
  reason?: string;
  acknowledged?: boolean;
  confirmation?: string;
  /**
   * Adjust only. The proposed copy is part of the intent's identity: retrying
   * the *same* text must reuse the key, while changing a word is a different
   * intent that must not inherit the previous one's slot.
   *
   * Only the fingerprint of these reaches storage — see `identity` below.
   */
  subject?: string;
  body_text?: string;
  expected_frozen_hash?: string;
}

interface TinyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const memory = new Map<string, string>();
const memoryStorage: TinyStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
};

function storage(): TinyStorage {
  try {
    const candidate = globalThis.localStorage;
    const probe = "cc-human-gate:storage-probe";
    candidate.setItem(probe, "1");
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return memoryStorage;
  }
}

function fingerprint(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + i), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

function identity(intent: HumanGateIntent): string {
  return JSON.stringify([
    intent.action,
    intent.version_id ?? "",
    intent.candidate_id ?? "",
    intent.limit ?? 0,
    intent.decision ?? "",
    intent.reason?.trim() ?? "",
    intent.acknowledged === true,
    intent.confirmation?.trim().toLowerCase() ?? "",
    // Proposed message content is folded into the identity as a fingerprint, so
    // the same retry keeps its key while different copy gets a different one —
    // and no subject or body is ever written to browser storage.
    intent.subject === undefined && intent.body_text === undefined
      ? ""
      : fingerprint(JSON.stringify([intent.subject ?? "", intent.body_text ?? ""])),
    intent.expected_frozen_hash ?? "",
  ]);
}

function stateKey(intent: HumanGateIntent): string {
  return `cc-human-gate:intent:${fingerprint(identity(intent))}`;
}

export function humanGateIdempotencyKey(intent: HumanGateIntent, store = storage()): string {
  const key = stateKey(intent);
  const generation = Number.parseInt(store.getItem(key) ?? "0", 10);
  const safeGeneration = Number.isSafeInteger(generation) && generation >= 0 ? generation : 0;
  return `cc-human-gate:v1:${key.slice(-16)}:${safeGeneration}`;
}

/** Advance only after a definitive executed/refused response. Unknown keeps the key. */
export function settleHumanGateIntent(
  intent: HumanGateIntent,
  outcome: string | undefined,
  store = storage(),
): void {
  if (outcome !== "executed" && outcome !== "refused") return;
  const key = stateKey(intent);
  const generation = Number.parseInt(store.getItem(key) ?? "0", 10);
  store.setItem(key, String((Number.isSafeInteger(generation) && generation >= 0 ? generation : 0) + 1));
}
