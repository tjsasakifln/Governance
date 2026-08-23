/**
 * One rule for "this name looks like a credential", applied at every boundary
 * that can put a value in front of an operator: the infrastructure catalog
 * parser, the snapshot projector, and the cockpit that renders the link.
 *
 * This file is duplicated verbatim at
 *   control-center/connectors/infrastructure/src/secret-keys.ts
 *   control-center/apps/web-shell/src/secret-keys.ts
 * because the collector must not import the contracts tree and the browser
 * bundle must not import the collector. The copies are byte-identical and a
 * test asserts it, so the rule cannot drift into three different rules — which
 * is how `?token[]=` came to be refused in one place and rendered in another.
 *
 * Matching is on the normalised name, not on separators, because `token[]`,
 * `token%5B%5D`, `x-api-key` and `api_key` are all the same key wearing
 * different punctuation. Short words (pass, ssh, pem) only match as a whole
 * segment, so `bypass` and `passenger` are not casualties.
 */
export const SECRET_KEY_WORDS = [
  "password",
  "passwd",
  "pass",
  "secret",
  "token",
  "apikey",
  "authorization",
  "privatekey",
  "ssh",
  "credential",
  "pem",
  "identity",
] as const;

export function isSecretKeyName(name: string): boolean {
  const parts = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part !== "");
  const normalized = parts.join("");
  if (normalized === "") {
    return false;
  }
  return SECRET_KEY_WORDS.some(
    (word) =>
      normalized === word ||
      parts.includes(word) ||
      (word.length >= 5 && (normalized.startsWith(word) || normalized.endsWith(word))),
  );
}

/**
 * True when a query string carries a credential-looking key, or a key that
 * cannot be decoded at all. An undecodable key is not something we can vouch
 * for, so it is refused rather than guessed at — and decoding never escapes
 * this function, which is what turned a malformed `%ZZ` into a crash.
 */
export function hasSecretQueryKey(query: string): boolean {
  const trimmed = query.startsWith("?") ? query.slice(1) : query;
  for (const pair of trimmed.split("&")) {
    if (pair === "") {
      continue;
    }
    const raw = pair.split("=")[0] ?? "";
    let key: string;
    try {
      key = decodeURIComponent(raw.replace(/\+/g, " "));
    } catch {
      return true;
    }
    if (isSecretKeyName(key)) {
      return true;
    }
  }
  return false;
}
