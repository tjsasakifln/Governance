/**
 * Named, individually typed operator actions.
 *
 * This is the ONLY place a Warmbly write may be described. There is no generic
 * proxy and no pass-through of a caller-supplied method+path: a caller names an
 * action, and the action owns its method, its path template and its body.
 *
 * Amended boundary (see README "Decisions"): three operational controls are
 * allowed. Everything else — send, dispatch-now, enroll, approve-content,
 * campaign start/stop, import/bootstrap, unibox reply/compose and every
 * Asaas/financial mutation — stays forbidden.
 */

export const OPERATOR_ACTION_NAMES = [
  "pause_dispatch",
  "resume_dispatch",
  "acknowledge_inbound_alert",
] as const;

export type OperatorActionName = (typeof OPERATOR_ACTION_NAMES)[number];

export type OperatorTargetKind = "dispatch" | "inbound_alert";

export type OperatorConfirmationMode = "none" | "two_step";

/** Singleton target for the dispatch kill switch. Not a path parameter. */
export const DISPATCH_TARGET_ID = "confenge-dispatch";

/**
 * Target ids are opaque, safe handles. No slashes, no dots-dots, no encoded
 * separators: a target can never widen the path into another Warmbly route.
 */
export const TARGET_ID_PATTERN = /^[A-Za-z0-9_~-]{1,128}$/;

/** Free-text audit reason. Control characters and separators are rejected. */
export const REASON_PATTERN = /^[A-Za-z0-9 _.,:;()À-ſ-]{1,200}$/;

export interface OperatorActionDefinition {
  readonly name: OperatorActionName;
  readonly method: "POST";
  readonly path_template: string;
  readonly target_kind: OperatorTargetKind;
  /** true when the target id is interpolated into the path. */
  readonly target_in_path: boolean;
  readonly default_target_id: string | null;
  readonly confirmation: OperatorConfirmationMode;
  readonly reason_required: boolean;
  readonly effect: string;
  buildPath(targetId: string): string;
  buildBody(input: { reason: string | null }): Record<string, unknown>;
}

const PAUSE: OperatorActionDefinition = {
  name: "pause_dispatch",
  method: "POST",
  path_template: "/v1/confenge/dispatch/pause",
  target_kind: "dispatch",
  target_in_path: false,
  default_target_id: DISPATCH_TARGET_ID,
  confirmation: "none",
  reason_required: true,
  effect: "engage the CONFENGE outbound kill switch (stops traffic)",
  buildPath: () => "/v1/confenge/dispatch/pause",
  buildBody: ({ reason }) => ({ reason: reason ?? "" }),
};

const RESUME: OperatorActionDefinition = {
  name: "resume_dispatch",
  method: "POST",
  path_template: "/v1/confenge/dispatch/resume",
  target_kind: "dispatch",
  target_in_path: false,
  default_target_id: DISPATCH_TARGET_ID,
  // Releasing the kill switch is the only action that can let traffic flow.
  confirmation: "two_step",
  reason_required: true,
  effect: "release the CONFENGE outbound kill switch (lets traffic flow)",
  buildPath: () => "/v1/confenge/dispatch/resume",
  buildBody: () => ({}),
};

const ACKNOWLEDGE: OperatorActionDefinition = {
  name: "acknowledge_inbound_alert",
  method: "POST",
  path_template: "/v1/confenge/inbound/{lead_id}/acknowledge",
  target_kind: "inbound_alert",
  target_in_path: true,
  default_target_id: null,
  confirmation: "none",
  reason_required: false,
  effect: "mark one inbound alert as seen by a human (no reply, no send)",
  buildPath: (targetId) => `/v1/confenge/inbound/${encodeURIComponent(targetId)}/acknowledge`,
  buildBody: () => ({}),
};

export const OPERATOR_ACTIONS: Readonly<Record<OperatorActionName, OperatorActionDefinition>> =
  Object.freeze({
    pause_dispatch: PAUSE,
    resume_dispatch: RESUME,
    acknowledge_inbound_alert: ACKNOWLEDGE,
  });

/**
 * Explicitly NOT reachable through this channel. Kept as data so the refusal
 * boundary is testable and greppable, never as a route table.
 */
export const OPERATOR_FORBIDDEN_ACTIONS = [
  "send",
  "send_email",
  "send_whatsapp",
  "dispatch_now",
  "dispatch_cohort",
  "enroll",
  "approve_content",
  "campaign_start",
  "campaign_stop",
  "import",
  "bootstrap",
  "unibox_reply",
  "unibox_compose",
  "charge",
  "refund",
  "payment",
] as const;

export function isOperatorActionName(value: unknown): value is OperatorActionName {
  return typeof value === "string" && (OPERATOR_ACTION_NAMES as readonly string[]).includes(value);
}

export function resolveOperatorAction(value: unknown): OperatorActionDefinition | undefined {
  if (!isOperatorActionName(value)) {
    return undefined;
  }
  return OPERATOR_ACTIONS[value];
}

export function isValidTargetId(value: unknown): value is string {
  return typeof value === "string" && TARGET_ID_PATTERN.test(value);
}

export function isValidReason(value: unknown): value is string {
  return typeof value === "string" && REASON_PATTERN.test(value.trim());
}
