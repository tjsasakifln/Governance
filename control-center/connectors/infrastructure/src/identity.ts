import type { ConnectionIdentity } from "./ports.js";
import type { AllowlistTarget } from "./types.js";

export const CANONICAL_CONNECT_HOST = "159.195.18.88";
export const CANONICAL_TLS_SERVER_NAME = "api.confenge.com.br";
export const CANONICAL_HTTP_HOST = "api.confenge.com.br";
export const CANONICAL_HEALTH_URL =
  "https://api.confenge.com.br/api/v1/webhooks/confenge/inbound/health";

export function connectHostOf(target: AllowlistTarget): string {
  return (target.connect_host ?? target.host ?? "").trim();
}

export function tlsServerNameOf(target: AllowlistTarget): string {
  const named = target.tls_server_name ?? target.http_host;
  if (named && named.trim() !== "") {
    return named.trim();
  }
  return connectHostOf(target);
}

export function httpHostOf(target: AllowlistTarget): string {
  if (target.http_host && target.http_host.trim() !== "") {
    return target.http_host.trim();
  }
  if (target.url) {
    try {
      const hostname = new URL(target.url).hostname;
      if (hostname) {
        return hostname;
      }
    } catch {
      // fall through
    }
  }
  if (target.tls_server_name && target.tls_server_name.trim() !== "") {
    return target.tls_server_name.trim();
  }
  return connectHostOf(target);
}

export function identityFor(target: AllowlistTarget): ConnectionIdentity {
  const identity: ConnectionIdentity = {};
  const connectHost = connectHostOf(target);
  if (connectHost) {
    Object.assign(identity, { connectHost });
  }
  const tlsServerName = tlsServerNameOf(target);
  if (tlsServerName) {
    Object.assign(identity, { tlsServerName });
  }
  const httpHost = httpHostOf(target);
  if (httpHost) {
    Object.assign(identity, { httpHost });
  }
  return identity;
}

export interface TlsConnectOptions {
  readonly host: string;
  readonly port: number;
  readonly servername: string;
  readonly rejectUnauthorized: false;
}

/** TCP host vs SNI servername. SNI mismatch must not be used as the TCP host. */
export function buildTlsConnectOptions(input: {
  readonly connectHost: string;
  readonly port: number;
  readonly tlsServerName?: string;
}): TlsConnectOptions {
  return {
    host: input.connectHost,
    port: input.port,
    servername: input.tlsServerName && input.tlsServerName.trim() !== ""
      ? input.tlsServerName.trim()
      : input.connectHost,
    rejectUnauthorized: false,
  };
}

export interface BuiltHttpRequest {
  readonly protocol: "http:" | "https:";
  readonly connectHost: string;
  readonly httpHost: string;
  readonly tlsServerName: string;
  readonly port: number;
  readonly method: "GET";
  readonly path: string;
  readonly headers: { readonly Host: string; readonly Accept: string; readonly "User-Agent": string };
  readonly timeoutMs: number;
  readonly rejectUnauthorized: boolean;
}

/**
 * HTTP identity: connect to connectHost (IP allowed), present Host + SNI as
 * the HTTP/TLS name. A non-SAN connect hostname must not become SNI/Host.
 */
export function buildHttpRequestOptions(input: {
  readonly url: string;
  readonly timeoutMs: number;
  readonly connectHost?: string;
  readonly httpHost?: string;
  readonly tlsServerName?: string;
}): BuiltHttpRequest {
  const url = new URL(input.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("http probe URL must be http(s)");
  }
  const urlHost = url.hostname;
  const httpHost = (input.httpHost && input.httpHost.trim() !== "" ? input.httpHost : urlHost).trim();
  const connectHost = (input.connectHost && input.connectHost.trim() !== ""
    ? input.connectHost
    : urlHost
  ).trim();
  const tlsServerName = (input.tlsServerName && input.tlsServerName.trim() !== ""
    ? input.tlsServerName
    : httpHost
  ).trim();
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  return {
    protocol: url.protocol,
    connectHost,
    httpHost,
    tlsServerName,
    port,
    method: "GET",
    path: `${url.pathname}${url.search}`,
    headers: {
      Host: httpHost,
      Accept: "application/json, text/plain, */*",
      "User-Agent": "ConfengeControlCenter-InfraCollector/1.0",
    },
    timeoutMs: input.timeoutMs,
    rejectUnauthorized: url.protocol === "https:",
  };
}
