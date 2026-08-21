import {
  MAX_JSON_BYTES,
  stripSecretOrPiiKeys,
} from "@confenge/control-center-persistence";

export const PERSIST_ARRAY_CAP = 50;

function asObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value: value ?? null };
}

function byteSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function capArrays(value: unknown, cap: number): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, cap).map((item) => capArrays(item, cap));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = capArrays(child, cap);
    }
    return out;
  }
  return value;
}

function largestDroppableKey(obj: Record<string, unknown>): string | undefined {
  let best: { key: string; size: number } | undefined;
  for (const [key, child] of Object.entries(obj)) {
    if (key === "_persist_truncation") continue;
    const size = byteSize(child);
    if (!best || size > best.size) {
      best = { key, size };
    }
  }
  return best?.key;
}

/**
 * Persistence rejects JSON payloads over 512KiB and any leftover PII keys.
 * Strip secrets, cap large arrays, then drop the largest remaining keys
 * until the object fits. Record the truncation so the gap is honest.
 */
export function fitPersistPayload(
  payload: unknown,
  maxBytes = MAX_JSON_BYTES,
): Record<string, unknown> {
  const stripped = stripSecretOrPiiKeys(payload);
  let current = asObject(stripped);
  const originalBytes = byteSize(current);
  if (originalBytes <= maxBytes) {
    return current;
  }

  const droppedKeys: string[] = [];
  let arraysCapped = false;
  const capped = capArrays(current, PERSIST_ARRAY_CAP);
  if (byteSize(capped) < originalBytes) {
    arraysCapped = true;
    current = asObject(capped);
  }

  const meta = (): Record<string, unknown> => ({
    reason: "payload_exceeds_persist_limit",
    original_bytes: originalBytes,
    limit_bytes: maxBytes,
    arrays_capped: arraysCapped,
    array_cap: PERSIST_ARRAY_CAP,
    dropped_keys: droppedKeys,
  });

  const withMeta = (): Record<string, unknown> => ({
    ...current,
    _persist_truncation: meta(),
  });

  while (byteSize(withMeta()) > maxBytes) {
    const dropKey = largestDroppableKey(current);
    if (!dropKey) {
      break;
    }
    droppedKeys.push(dropKey);
    const next = { ...current };
    delete next[dropKey];
    current = next;
  }

  return withMeta();
}
