import {
  clearInteractionDraft,
  interactionDraftValue,
  rememberInteractionDraft,
  resetInteractionDrafts,
} from "./interaction-draft";

const NOTE_FIELD = "note";

export function operatorActionDraftKey(action: string, canonicalId: string, sourceId: string): string {
  return `${action.slice(0, 80)}\u0000${canonicalId.slice(0, 256)}\u0000${sourceId.slice(0, 256)}`;
}

export function rememberOperatorActionDraft(key: string, note: string): void {
  if (!key) return;
  if (!note) {
    clearInteractionDraft(key);
    return;
  }
  rememberInteractionDraft(key, { [NOTE_FIELD]: note.slice(0, 500) });
}

export function operatorActionDraft(key: string): string {
  return interactionDraftValue(key, NOTE_FIELD);
}

export function clearOperatorActionDraft(key: string): void {
  clearInteractionDraft(key);
}

export function resetOperatorActionDrafts(): void {
  resetInteractionDrafts();
}
