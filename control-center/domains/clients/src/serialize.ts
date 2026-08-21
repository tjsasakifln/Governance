/**
 * Canonical JSON for equality of two consumer runs.
 * Object keys are sorted; array order is preserved (builders sort first).
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const [key, child] of entries) {
      out[key] = canonicalize(child);
    }
    return out;
  }
  return value;
}

export function serializeCanonical(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function serializeClientStatus(value: unknown): string {
  return serializeCanonical(value);
}

export function serializeAttention(value: unknown): string {
  return serializeCanonical(value);
}
