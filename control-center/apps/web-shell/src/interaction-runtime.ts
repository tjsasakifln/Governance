/** Compact interaction evidence intentionally shipped to the browser. */
export const INTERACTION_FEEDBACK_BUDGET_MS = 100 as const;

export const MUTABLE_INTERACTION_IDS = [
  "today.directive",
  "today.acknowledge",
  "activity.assign",
  "activity.mark-triaged",
  "exceptions.acknowledge",
  "exceptions.start-work",
  "lead.record-note",
  "lead.mark-reviewed",
  "lead.review-activity",
  "lead.confirm-next",
  "lead.reject-next",
  "lead.acknowledge-exception",
  "lead.reopen-exception",
  "lead.warmbly-acknowledge",
  "draft.save",
  "draft.approve",
  "draft.reject",
  "dispatch.pause",
  "dispatch.resume",
  "gate.create",
  "gate.recover",
  "gate.validate",
  "gate.approve",
  "gate.hold-reject",
  "gate.adjust",
  "gate.reproduce",
  "gate.reconcile",
] as const;

export const CRITICAL_INTERACTION_JOURNEYS = [
  { id: "daily-triage", before: 3, after: 1 },
  { id: "exception-acknowledge", before: 3, after: 1 },
  { id: "inbound-acknowledge", before: 4, after: 1 },
  { id: "approve-and-queue", before: 2, after: 1 },
  { id: "adjust-version", before: 6, after: 5 },
] as const;
