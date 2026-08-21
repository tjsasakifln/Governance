import type { HttpRequest, HttpResponse, HttpTransport } from "./types.js";

export const liveTransport: HttpTransport = async (req: HttpRequest): Promise<HttpResponse> => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    throw new Error(`Refusing non-read HTTP method ${req.method}`);
  }
  const response = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    redirect: "manual",
  });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    status: response.status,
    headers,
    body: await response.text(),
  };
};
