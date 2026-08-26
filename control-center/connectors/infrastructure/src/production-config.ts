import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAllowlist } from "./allowlist.js";
import {
  CANONICAL_CONNECT_HOST,
  CANONICAL_HEALTH_URL,
  CANONICAL_HTTP_HOST,
  CANONICAL_TLS_SERVER_NAME,
  connectHostOf,
  httpHostOf,
  tlsServerNameOf,
} from "./identity.js";
import { findPackageRoot } from "./paths.js";
import type { Allowlist } from "./types.js";

export {
  CANONICAL_CONNECT_HOST,
  CANONICAL_HEALTH_URL,
  CANONICAL_HTTP_HOST,
  CANONICAL_TLS_SERVER_NAME,
} from "./identity.js";

export const PRODUCTION_ALLOWLIST_RELATIVE = "config/allowlist.production.json";

export function productionAllowlistPath(): string {
  return join(findPackageRoot(), PRODUCTION_ALLOWLIST_RELATIVE);
}

export function loadProductionAllowlist(): Allowlist {
  const raw: unknown = JSON.parse(readFileSync(productionAllowlistPath(), "utf8"));
  const allowlist = parseAllowlist(raw);
  assertProductionIdentity(allowlist);
  return allowlist;
}

export function assertProductionIdentity(allowlist: Allowlist): void {
  const tcp = allowlist.targets.find((target) => target.checks.includes("reachability"));
  const tls = allowlist.targets.find((target) => target.checks.includes("tls"));
  const http = allowlist.targets.find((target) => target.checks.includes("http"));
  if (!tcp || !tls || !http) {
    throw new Error("production allowlist must include reachability, tls, and http targets");
  }
  if (connectHostOf(tcp) !== CANONICAL_CONNECT_HOST) {
    throw new Error(`TCP connect_host must be ${CANONICAL_CONNECT_HOST}`);
  }
  if (tlsServerNameOf(tls) !== CANONICAL_TLS_SERVER_NAME) {
    throw new Error(`TLS servername must be ${CANONICAL_TLS_SERVER_NAME}`);
  }
  if (connectHostOf(tls) === CANONICAL_TLS_SERVER_NAME) {
    throw new Error("TLS connect host must stay independent of tls_server_name");
  }
  if (http.url !== CANONICAL_HEALTH_URL) {
    throw new Error(`HTTP health URL must be ${CANONICAL_HEALTH_URL}`);
  }
  if (httpHostOf(http) !== CANONICAL_HTTP_HOST || tlsServerNameOf(http) !== CANONICAL_TLS_SERVER_NAME) {
    throw new Error(`HTTP Host/SNI must be ${CANONICAL_HTTP_HOST}`);
  }
  if (http.url.includes("happysrv.de") || httpHostOf(http) === "happysrv.de") {
    throw new Error("HTTP identity must not use happysrv.de");
  }
  const preparedPublicEdge = allowlist.targets.find(
    (target) => target.id === "confenge-public-edge",
  );
  if (!preparedPublicEdge || preparedPublicEdge.lifecycle_state !== "PREPARED/NOT_LIVE") {
    throw new Error("confenge public edge must remain PREPARED/NOT_LIVE before cutover");
  }
  if (
    connectHostOf(preparedPublicEdge) !== CANONICAL_CONNECT_HOST ||
    httpHostOf(preparedPublicEdge) !== "confenge.com.br" ||
    tlsServerNameOf(preparedPublicEdge) !== "confenge.com.br"
  ) {
    throw new Error("prepared confenge public edge must use canonical Netcup IPv4 with apex Host/SNI");
  }
}
