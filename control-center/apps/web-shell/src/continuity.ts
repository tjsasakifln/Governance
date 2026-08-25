import {
  COMMERCIAL_SURFACES,
  DESTINATION_IDS,
  WARMBLY_SURFACES,
} from "./destinations";

export const CONTINUITY_SCHEMA = "control-center.task-continuity.v1" as const;
export const CONTINUITY_STORAGE_KEY = "confenge.control-center.task-continuity.v1";
export const CONTINUITY_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const CONTINUITY_RECOVERY_HASH = "#/hoje?continuity=recovered";
export const CONTINUITY_END_FOCUS = "queue-summary";
export const CONTINUITY_FIRST_FOCUS = "queue-first";

/**
 * These are the only query values allowed to survive reload/reauthentication.
 * Typed notes, message copy, reasons, confirmations and unsubmitted decisions
 * never enter this list and therefore never enter sessionStorage.
 */
export const DURABLE_CONTINUITY_PARAMS = [
  "q",
  "condicao",
  "estado",
  "tipo",
  "origem",
  "responsavel",
  "prioridade",
  "periodo",
  "ordem",
  "pagina",
  "por_pagina",
  "offset",
  "resource",
  "client",
  "surface",
  "pos",
  "of",
  "freshness",
  "mensagens",
] as const;

export const NON_DURABLE_CONTINUITY_PARAMS = [
  "focus",
  "view",
  "mode",
  "note",
  "reason",
  "subject",
  "body",
  "confirmation_token",
] as const;

export const CONTINUITY_SURFACE_CONTRACTS = [
  { id: "messages", route: "#/comercial/rascunhos", selector: "[data-review-list-item]" },
  { id: "inbound", route: "#/comercial/atividade?condicao=unread", selector: "[data-activity-id]" },
  { id: "exceptions", route: "#/comercial/excecoes", selector: "[data-exception-id]" },
  { id: "leads", route: "#/comercial/atividade?resource=lead", selector: "[data-lead-detail]" },
  { id: "clients", route: "#/clientes/acme-industria", selector: "[data-client]" },
  { id: "activities", route: "#/comercial/atividade", selector: "[data-list='atividade']" },
] as const;

export interface ContinuityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredContinuity {
  readonly schema: typeof CONTINUITY_SCHEMA;
  readonly subject: string;
  readonly hash: string;
  readonly savedAt: number;
}

const durableParams = new Set<string>(DURABLE_CONTINUITY_PARAMS);

function isValidContinuitySubject(subject: string): boolean {
  return subject.length > 0 && subject.length <= 320 && !/[\u0000-\u001f<>]/.test(subject);
}

/** Bind browser continuity to the authenticated actor represented by server-injected metadata. */
export function continuitySubjectFromDocument(
  doc: { querySelector(selector: string): { getAttribute(name: string): string | null } | null } | undefined =
    typeof document !== "undefined" ? document : undefined,
): string | null {
  const id = doc?.querySelector('meta[name="cc-actor-id"]')?.getAttribute("content")?.trim() ?? "";
  const kind = doc?.querySelector('meta[name="cc-actor-kind"]')?.getAttribute("content")?.trim() ?? "";
  const subject = `${kind}:${id}`;
  return (kind === "human" || kind === "agent" || kind === "system")
    && isValidContinuitySubject(subject)
    ? subject
    : null;
}

function pathIsRecognized(path: string): boolean {
  const segments = path.replace(/^\/+/, "").split("/").filter(Boolean);
  const destination = segments[0] ?? "";
  if (!(DESTINATION_IDS as readonly string[]).includes(destination)) return false;
  if (destination === "comercial") {
    return segments.length <= 2
      && (!segments[1] || (COMMERCIAL_SURFACES as readonly string[]).includes(segments[1]));
  }
  if (destination === "warmbly") {
    return segments.length <= 2
      && (!segments[1] || (WARMBLY_SURFACES as readonly string[]).includes(segments[1]));
  }
  if (destination === "clientes") return segments.length <= 2;
  return segments.length === 1;
}

export function isRecognizedContinuityHash(hash: string): boolean {
  if (!hash.startsWith("#/")) return false;
  const [path = ""] = hash.slice(1).split("?");
  return path.length <= 320 && !/[\u0000-\u001f<>]/.test(path) && pathIsRecognized(path);
}

/** A bounded, non-sensitive location suitable for session continuity. */
export function durableContinuityHash(hash: string): string | null {
  if (!isRecognizedContinuityHash(hash)) return null;
  const [path = "/hoje", query = ""] = hash.slice(1).split("?");
  const safe = new URLSearchParams();
  for (const [key, rawValue] of new URLSearchParams(query)) {
    if (!durableParams.has(key)) continue;
    const value = rawValue.trim();
    if (!value || value.length > 256 || /[\u0000-\u001f]/.test(value)) continue;
    safe.set(key, value);
  }
  const rendered = safe.toString();
  return `#${path}${rendered ? `?${rendered}` : ""}`;
}

export function rememberContinuity(
  storage: ContinuityStorage,
  hash: string,
  subject: string,
  now = Date.now(),
): boolean {
  if (!isValidContinuitySubject(subject)) return false;
  const durable = durableContinuityHash(hash);
  if (!durable) return false;
  const value: StoredContinuity = { schema: CONTINUITY_SCHEMA, subject, hash: durable, savedAt: now };
  try {
    storage.setItem(CONTINUITY_STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function restoreContinuity(
  storage: ContinuityStorage,
  subject: string,
  now = Date.now(),
): string | null {
  try {
    const raw = storage.getItem(CONTINUITY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredContinuity>;
    const validAge = typeof parsed.savedAt === "number"
      && parsed.savedAt <= now
      && now - parsed.savedAt <= CONTINUITY_MAX_AGE_MS;
    const hash = typeof parsed.hash === "string" ? durableContinuityHash(parsed.hash) : null;
    if (
      !isValidContinuitySubject(subject)
      || parsed.schema !== CONTINUITY_SCHEMA
      || parsed.subject !== subject
      || !validAge
      || !hash
    ) {
      storage.removeItem(CONTINUITY_STORAGE_KEY);
      return null;
    }
    return hash;
  } catch {
    try { storage.removeItem(CONTINUITY_STORAGE_KEY); } catch { /* storage unavailable */ }
    return null;
  }
}

const CROSS_SURFACE_PARAMS = [
  "q",
  "estado",
  "origem",
  "responsavel",
  "prioridade",
  "periodo",
  "ordem",
  "por_pagina",
  "resource",
  "freshness",
  "mensagens",
] as const;

/** Preserve compatible context while changing sibling subroutes. */
export function continuitySubrouteHref(currentHash: string, targetHash: string): string {
  if (!isRecognizedContinuityHash(targetHash)) return CONTINUITY_RECOVERY_HASH;
  const [currentPath = "", currentQuery = ""] = currentHash.split("?");
  const [targetPath = targetHash, targetQuery = ""] = targetHash.split("?");
  if (currentPath === targetPath) return currentHash;
  const current = new URLSearchParams(currentQuery);
  const target = new URLSearchParams(targetQuery);
  for (const key of CROSS_SURFACE_PARAMS) {
    const value = current.get(key);
    if (value && !target.has(key)) target.set(key, value);
  }
  const query = target.toString();
  return `${targetPath}${query ? `?${query}` : ""}`;
}

/** Location used after a definitive queue action. */
export function actionContinuationHash(currentHash: string, nextFocus?: string | null): string {
  const [path = "#/hoje", query = ""] = currentHash.split("?");
  const params = new URLSearchParams(query);
  params.delete("resource");
  params.delete("pos");
  params.delete("of");
  params.delete("mode");
  params.set("focus", nextFocus || CONTINUITY_END_FOCUS);
  const rendered = params.toString();
  return `${path}${rendered ? `?${rendered}` : ""}`;
}
