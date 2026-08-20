export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

export function readString(record: Record<string, unknown>, key: string): string | null {
  return asString(record[key]);
}

export function readNumber(record: Record<string, unknown>, key: string): number | null {
  return asNumber(record[key]);
}

export function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  return asBoolean(record[key]);
}

export function nestedRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  return asRecord(record[key]);
}
