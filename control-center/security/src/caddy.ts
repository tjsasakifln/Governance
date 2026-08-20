import {
  FORWARD_AUTH_HEADERS,
  FORWARD_AUTH_URI,
  PUBLIC_HEALTH_PATHS,
  REQUIRED_SECURITY_HEADERS,
} from "./constants.js";

export interface CaddyAnalysis {
  readonly hasForwardAuth: boolean;
  readonly hasForwardAuthUri: boolean;
  readonly copyHeaders: readonly string[];
  readonly missingCopyHeaders: readonly string[];
  readonly hasTls: boolean;
  readonly missingSecurityHeaders: readonly string[];
  readonly corsWildcard: boolean;
  readonly hasHealthMatcher: boolean;
  readonly obscureUnauthenticatedPath: boolean;
  readonly unauthenticatedAppProxyWithoutForwardAuth: boolean;
  readonly hasBasicAuth: boolean;
}

function stripComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const hash = line.indexOf("#");
      if (hash === 0 || (hash > 0 && line.slice(0, hash).trim() === "")) {
        return "";
      }
      const inline = line.indexOf(" #");
      return inline >= 0 ? line.slice(0, inline) : line;
    })
    .join("\n");
}

function includesHeader(text: string, header: string): boolean {
  return text.toLowerCase().includes(header.toLowerCase());
}

const OBSCURE_PATH = /(?:path|handle|matcher)?\s*\/[A-Za-z0-9_-]{12,}\b/;

export function analyzeCaddyfile(text: string): CaddyAnalysis {
  const body = stripComments(text);
  const lower = body.toLowerCase();
  const hasForwardAuth = /\bforward_auth\b/.test(lower);
  const hasForwardAuthUri = body.includes(FORWARD_AUTH_URI);
  const copyLine = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.toLowerCase().startsWith("copy_headers"));
  const copyHeaders = copyLine
    ? copyLine
        .slice("copy_headers".length)
        .trim()
        .split(/\s+/)
        .filter((h) => h.length > 0)
    : [];
  const missingCopyHeaders = FORWARD_AUTH_HEADERS.filter(
    (h) => !copyHeaders.some((c) => c.toLowerCase() === h.toLowerCase()),
  );
  const hasTls = /(^|\s)tls\s+/m.test(body);
  const missingSecurityHeaders = REQUIRED_SECURITY_HEADERS.filter((h) => !includesHeader(body, h));
  const corsWildcard = /access-control-allow-origin\s+"?\*"?/i.test(body);
  const hasHealthMatcher = PUBLIC_HEALTH_PATHS.every((p) => body.includes(p));
  const hasBasicAuth = /\bbasic_?auth\b/.test(lower);
  const obscureUnauthenticatedPath = !hasForwardAuth && OBSCURE_PATH.test(body);
  const unauthenticatedAppProxyWithoutForwardAuth =
    !hasForwardAuth && /\breverse_proxy\b/.test(lower);

  return {
    hasForwardAuth,
    hasForwardAuthUri,
    copyHeaders,
    missingCopyHeaders,
    hasTls,
    missingSecurityHeaders,
    corsWildcard,
    hasHealthMatcher,
    obscureUnauthenticatedPath,
    unauthenticatedAppProxyWithoutForwardAuth,
    hasBasicAuth,
  };
}
