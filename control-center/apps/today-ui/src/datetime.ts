/** Internal timestamps are UTC (`...Z`). Presentation may use America/Sao_Paulo. */
export const PRESENTATION_TIME_ZONE = "America/Sao_Paulo";

const UTC_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;

export function isUtcDateTime(value: string): boolean {
  return UTC_PATTERN.test(value);
}

export function formatUtc(value: string): string {
  return value;
}

export function formatLocal(value: string, timeZone = PRESENTATION_TIME_ZONE): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${formatted} (${timeZone})`;
}
