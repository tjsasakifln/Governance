/** Secret-shaped values. Matched content is never promoted to a candidate. */
const SECRET_CONTENT_PATTERNS: readonly RegExp[] = [
  /ghp_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bsk_live_[A-Za-z0-9]{16,}/g,
  /\bsk_test_[A-Za-z0-9]{16,}/g,
  /CONFENGE_MCP_AUTH_TOKEN\s*=\s*\S+/g,
];

export function contentSecretReason(text: string): string | null {
  for (const pattern of SECRET_CONTENT_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return "secret_or_pii_content";
    }
  }
  return null;
}

export function redactSecretShapes(value: string): string {
  let next = value;
  for (const pattern of SECRET_CONTENT_PATTERNS) {
    next = next.replace(pattern, "[redacted]");
  }
  return next;
}
