import { readFileSync } from "node:fs";
import { failClosed } from "./fail-closed.ts";
import { CADDY_FILE } from "./paths.ts";

export interface CaddyReverseProxy {
  path: string;
  upstream: string;
}

export interface CaddyHook {
  reverseProxies: CaddyReverseProxy[];
  documentsAutomaticHttps: boolean;
  usesTlsInternal: boolean;
  adminOff: boolean;
  jsonLogs: boolean;
}

const REQUIRED_UPSTREAMS = ["context:8080", "mcp:8080", "web:8080"] as const;

export function parseCaddyfile(text: string): CaddyHook {
  const reverseProxies: CaddyReverseProxy[] = [];
  let currentPath = "/";
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    const handle = line.match(/^handle\s+(\S+)\s*\{?$/);
    if (handle) {
      currentPath = handle[1] ?? "/";
    } else if (line === "handle {") {
      currentPath = "/";
    }
    const proxy = line.match(/^reverse_proxy\s+(\S+)/);
    if (proxy && proxy[1]) {
      reverseProxies.push({ path: currentPath, upstream: proxy[1] });
    }
  }
  const documentsAutomaticHttps =
    /automatic HTTPS/i.test(text) && /ACME/i.test(text) && /80\/443/.test(text);
  return {
    reverseProxies,
    documentsAutomaticHttps,
    usesTlsInternal: /tls\s+internal/.test(text),
    adminOff: /admin\s+off/.test(text),
    jsonLogs: /format\s+json/.test(text),
  };
}

export function loadCaddy(path = CADDY_FILE): { text: string; hook: CaddyHook } {
  const text = readFileSync(path, "utf8");
  return { text, hook: parseCaddyfile(text) };
}

export function assertCaddyHook(hook: CaddyHook): void {
  const upstreams = new Set(hook.reverseProxies.map((p) => p.upstream));
  for (const required of REQUIRED_UPSTREAMS) {
    if (!upstreams.has(required)) {
      failClosed(`Caddyfile missing reverse_proxy ${required}`);
    }
  }
  const paths = hook.reverseProxies.map((p) => p.path);
  if (!paths.includes("/healthz") || !paths.includes("/ready")) {
    failClosed("Caddyfile must reverse_proxy /healthz and /ready");
  }
  if (!hook.documentsAutomaticHttps) {
    failClosed("Caddyfile must document automatic HTTPS for later convergence");
  }
  if (!hook.usesTlsInternal) {
    failClosed("Caddyfile must use tls internal on the high HTTPS port this wave");
  }
  if (!hook.adminOff) {
    failClosed("Caddy admin API must be off");
  }
}
