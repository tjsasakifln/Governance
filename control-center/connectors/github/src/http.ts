import type { HttpResponse } from "./types.js";

export function header(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want) {
      return value;
    }
  }
  return undefined;
}

export function joinUrl(apiBase: string, path: string, query?: Record<string, string>): string {
  const base = apiBase.endsWith("/") ? apiBase.slice(0, -1) : apiBase;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${suffix}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function emptyResponse(status: number, message: string): HttpResponse {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  };
}
