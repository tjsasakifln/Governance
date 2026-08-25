/**
 * Volatile form memory for recoverable write failures.
 *
 * This intentionally never touches localStorage/sessionStorage: operational
 * notes and message bodies can be sensitive. A full reload clears the map,
 * while a shell repaint after a refused or unknown response can restore what
 * the operator typed.
 */
export type InteractionDraft = Readonly<Record<string, string>>;

const drafts = new Map<string, InteractionDraft>();

export function rememberInteractionDraft(key: string, fields: Record<string, string>): void {
  if (!key) return;
  const boundedKey = key.slice(0, 768);
  const bounded = Object.fromEntries(
    Object.entries(fields)
      .slice(0, 24)
      .map(([field, value]) => [field.slice(0, 80), String(value).slice(0, 8000)]),
  );
  drafts.set(boundedKey, bounded);
}

export function interactionDraft(key: string): InteractionDraft | undefined {
  const draft = drafts.get(key.slice(0, 768));
  return draft ? { ...draft } : undefined;
}

export function interactionDraftValue(key: string, field: string, fallback = ""): string {
  return drafts.get(key.slice(0, 768))?.[field.slice(0, 80)] ?? fallback;
}

export function clearInteractionDraft(key: string): void {
  if (key) drafts.delete(key.slice(0, 768));
}

/** Test seam. Production drafts otherwise live until success or reload. */
export function resetInteractionDrafts(): void {
  drafts.clear();
}
