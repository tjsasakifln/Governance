/**
 * Editorial state of a frozen cohort version.
 *
 * A version composed by a superseded composer still has to be readable for
 * audit, but it is not sendable. The founder saw defective legacy copy offered
 * with APPROVE and GO beside it, so this reading exists to tell the surface
 * which of the two it is looking at.
 *
 * Defaulting rule: an absent `editorial_state` is an older backend, not a
 * legacy version. Absent reads as CURRENT and actionable so the working flow
 * keeps working; only `LEGACY_SUPERSEDED` (or an explicit `actionable: false`)
 * turns on the historical treatment.
 */

import { ownMapValue } from "../own-map";

export const LEGACY_EDITORIAL_STATE = "LEGACY_SUPERSEDED";
export const CURRENT_EDITORIAL_STATE = "CURRENT";

export type EditorialState = typeof CURRENT_EDITORIAL_STATE | typeof LEGACY_EDITORIAL_STATE;

export interface EditorialReading {
  /** What the surface renders in `data-editorial-state`. */
  state: EditorialState;
  /** True when the historical treatment applies. */
  legacy: boolean;
  /** False removes every decision affordance from the markup. */
  actionable: boolean;
  reasonCodes: string[];
  /** pt-BR sentence written by the server. Empty when it did not send one. */
  notice: string;
  /** Highest version number for this cohort, as sent. Empty when absent. */
  currentVersion: string;
  /** Version id to link to. Empty when absent. */
  currentVersionId: string;
  isCurrentVersion: boolean | undefined;
}

const REASON_LABELS: Readonly<Record<string, string>> = {
  composer_superseded: "composta por um redator anterior ao vigente",
  composer_unstamped: "sem carimbo de redator",
  policy_superseded: "criada sob uma policy anterior",
};

/** Unknown codes are shown verbatim: inventing a translation would hide them. */
export function editorialReasonLabel(code: string): string {
  return ownMapValue(REASON_LABELS, code) ?? code;
}

export function editorialReasonSentence(codes: readonly string[]): string {
  const labels = codes.map(editorialReasonLabel).filter((label) => label !== "");
  return labels.length > 0 ? labels.join("; ") : "";
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function readEditorialState(source: Record<string, unknown>): EditorialReading {
  const declaredLegacy = text(source.editorial_state) === LEGACY_EDITORIAL_STATE;
  const actionable = source.actionable === false ? false : !declaredLegacy;
  const legacy = declaredLegacy || !actionable;
  const reasonCodes = Array.isArray(source.editorial_reason_codes)
    ? source.editorial_reason_codes.filter((entry): entry is string => typeof entry === "string" && entry !== "")
    : [];
  const currentVersion =
    typeof source.current_version === "number" || typeof source.current_version === "string"
      ? String(source.current_version)
      : "";
  return {
    state: legacy ? LEGACY_EDITORIAL_STATE : CURRENT_EDITORIAL_STATE,
    legacy,
    actionable,
    reasonCodes,
    notice: text(source.editorial_notice),
    currentVersion,
    currentVersionId: text(source.current_version_id),
    isCurrentVersion: typeof source.is_current_version === "boolean" ? source.is_current_version : undefined,
  };
}

/**
 * A candidate inherits the version's verdict: a candidate cannot be actionable
 * inside a historical version, and its own reason codes win when it has any.
 */
export function mergeEditorialState(
  cohort: EditorialReading,
  candidate: EditorialReading,
): EditorialReading {
  const legacy = cohort.legacy || candidate.legacy;
  return {
    state: legacy ? LEGACY_EDITORIAL_STATE : CURRENT_EDITORIAL_STATE,
    legacy,
    actionable: cohort.actionable && candidate.actionable,
    reasonCodes: candidate.reasonCodes.length > 0 ? candidate.reasonCodes : cohort.reasonCodes,
    notice: candidate.notice || cohort.notice,
    currentVersion: cohort.currentVersion,
    currentVersionId: cohort.currentVersionId,
    isCurrentVersion: cohort.isCurrentVersion,
  };
}
