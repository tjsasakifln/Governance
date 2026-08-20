import { SHORTCUT_KINDS, type ShortcutKind } from "./taxonomy.js";
import { isUtcDateTime } from "./datetime.js";
import type { UtcDateTime } from "./types.js";

export interface RegistrarDraft {
  title: string;
  body: string;
}

export interface RegistrarReceipt {
  accepted: true;
  persisted: false;
  target: "local-intent";
  kind: ShortcutKind;
  title: string;
  recorded_at: UtcDateTime;
  mutates_external: false;
}

export type ClockFn = () => UtcDateTime;

/**
 * Founder-facing shortcut. Records an intent in-process.
 * Does not write directives persistence, Warmbly, Asaas, GitHub, or any
 * other external system this wave.
 */
export function recordIntent(
  kind: ShortcutKind,
  draft: RegistrarDraft,
  clock: ClockFn,
): RegistrarReceipt {
  if (!(SHORTCUT_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`Unknown shortcut kind: ${kind}`);
  }
  const recorded_at = clock();
  if (!isUtcDateTime(recorded_at)) {
    throw new Error("clock() must return UTC RFC3339 with Z");
  }
  const title = draft.title.trim();
  if (title.length === 0) {
    throw new Error("title is required");
  }
  return {
    accepted: true,
    persisted: false,
    target: "local-intent",
    kind,
    title,
    recorded_at,
    mutates_external: false,
  };
}

export const SHORTCUT_DECISION_LABEL = "Registrar decisão";
export const SHORTCUT_NOTA_LABEL = "Registrar nota";
