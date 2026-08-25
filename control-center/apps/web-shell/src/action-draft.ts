/**
 * Volatile notes for an operator action whose outcome is not definitive.
 *
 * This map survives a wholesale DOM repaint but deliberately does not survive
 * reload or reauthentication. Notes may contain sensitive operational context;
 * sessionStorage/localStorage are therefore outside this contract.
 */
const notes = new Map<string, string>();

export function operatorActionDraftKey(action: string, canonicalId: string, sourceId: string): string {
  return `${action.slice(0, 80)}\u0000${canonicalId.slice(0, 256)}\u0000${sourceId.slice(0, 256)}`;
}

export function rememberOperatorActionDraft(key: string, note: string): void {
  if (!key) return;
  if (!note) {
    notes.delete(key);
    return;
  }
  notes.set(key, note.slice(0, 500));
}

export function operatorActionDraft(key: string): string {
  return notes.get(key) ?? "";
}

export function clearOperatorActionDraft(key: string): void {
  notes.delete(key);
}

export function resetOperatorActionDrafts(): void {
  notes.clear();
}
