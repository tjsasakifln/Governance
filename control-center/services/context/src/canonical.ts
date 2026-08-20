function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      const item = src[key];
      if (item === undefined) {
        continue;
      }
      out[key] = sortValue(item);
    }
    return out;
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return `${JSON.stringify(sortValue(value))}\n`;
}

export function stableEqualJson(a: unknown, b: unknown): boolean {
  return canonicalStringify(a) === canonicalStringify(b);
}
