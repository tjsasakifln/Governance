import { AsaasConnectorError } from "./errors.js";

/**
 * Store dates in UTC internally. Asaas date-only values are the calendar
 * date at midnight UTC (the provider date as stated, not a TZ conversion).
 * Naive datetimes (`YYYY-MM-DD HH:mm:ss`) are treated as UTC.
 */
export function asaasDateToUtcIso(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new AsaasConnectorError("asaas.date.empty", "empty Asaas date");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00.000Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed.replace(" ", "T")}.000Z`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new AsaasConnectorError(
      "asaas.date.invalid",
      `unparseable Asaas date: ${trimmed}`,
    );
  }
  return parsed.toISOString();
}

export function optionalAsaasDateToUtcIso(
  value: string | null | undefined,
): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const trimmed = String(value).trim();
  if (trimmed === "") {
    return undefined;
  }
  return asaasDateToUtcIso(trimmed);
}

export function toUtcIso(date: Date): string {
  return date.toISOString();
}
