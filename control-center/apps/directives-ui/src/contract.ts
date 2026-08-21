import {
  AUTHORITATIVE_KINDS,
  CREATE_STATUSES,
  DIRECTIVE_KINDS,
  DIRECTIVE_STATUSES,
  FORBIDDEN_MUTATIONS,
  ORIENTATIVE_KINDS,
  SCOPE_LITERALS,
  SESSION_ROLES,
  type AuthoritativeKind,
  type CreateStatus,
  type DirectiveKind,
  type DirectiveStatus,
  type ForbiddenMutation,
  type Scope,
  type SessionRole,
} from "./types.ts";

export const UTC_DATETIME_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;

export const RESOURCE_ID_PATTERN = /^cc:[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$/;

export const SCOPE_PATTERN =
  /^(company|commercial|finance|clients|infrastructure|inbound|repo:[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?|client:[a-z0-9]+(?:-[a-z0-9]+)*|[a-z][a-z0-9-]*:[A-Za-z0-9._:~-]+)$/;

export const ACTOR_ID_PATTERN = /^[A-Za-z0-9._:@-]+$/;

export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const TITLE_MAX = 200;
export const BODY_MAX = 8000;

export const FORBIDDEN_SECRET_KEY_REGEX =
  /^(secret|token|password|authorization|api[_-]?key|cookie|credential|private[_-]?key)$/i;

export function isDirectiveKind(value: string): value is DirectiveKind {
  return (DIRECTIVE_KINDS as readonly string[]).includes(value);
}

export function isDirectiveStatus(value: string): value is DirectiveStatus {
  return (DIRECTIVE_STATUSES as readonly string[]).includes(value);
}

export function isCreateStatus(value: string): value is CreateStatus {
  return (CREATE_STATUSES as readonly string[]).includes(value);
}

export function isSessionRole(value: string): value is SessionRole {
  return (SESSION_ROLES as readonly string[]).includes(value);
}

export function isAuthoritativeKind(kind: DirectiveKind): kind is AuthoritativeKind {
  return (AUTHORITATIVE_KINDS as readonly string[]).includes(kind);
}

export function isHypothesisKind(kind: DirectiveKind): boolean {
  return kind === "hypothesis";
}

export function isOrientativeKind(kind: DirectiveKind): boolean {
  return (ORIENTATIVE_KINDS as readonly string[]).includes(kind);
}

export function isUtcDateTime(value: string): boolean {
  return UTC_DATETIME_PATTERN.test(value);
}

export function isResourceId(value: string): boolean {
  return RESOURCE_ID_PATTERN.test(value);
}

export function isScope(value: string): value is Scope {
  return value.length >= 2 && value.length <= 128 && SCOPE_PATTERN.test(value);
}

export function isScopeLiteral(value: string): boolean {
  return (SCOPE_LITERALS as readonly string[]).includes(value);
}

export function isForbiddenMutation(value: string): value is ForbiddenMutation {
  return (FORBIDDEN_MUTATIONS as readonly string[]).includes(value);
}

export function looksLikeSecretKey(key: string): boolean {
  return FORBIDDEN_SECRET_KEY_REGEX.test(key);
}

export function authorityClass(
  kind: DirectiveKind,
): "authoritative" | "orientative" | "hypothesis" {
  if (isHypothesisKind(kind)) return "hypothesis";
  if (isAuthoritativeKind(kind)) return "authoritative";
  return "orientative";
}
