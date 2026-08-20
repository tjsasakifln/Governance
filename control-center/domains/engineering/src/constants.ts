/** Local copy of the GitHub collector snapshot schema id. */
export const COLLECTOR_ENGINEERING_SNAPSHOT_SCHEMA =
  "confenge.control_center.engineering_snapshot.v1" as const;

/** Canonical Control Center engineering snapshot schema (convergence target). */
export const CANONICAL_ENGINEERING_SNAPSHOT_SCHEMA =
  "control-center.engineering-snapshot.v1" as const;

export const ATTENTION_ITEM_SCHEMA = "control-center.attention-item.v1" as const;

export const REPO_EXECUTIVE_SCHEMA =
  "control-center.engineering-repo-executive.v1" as const;

export const COMPANY_EXECUTIVE_SCHEMA =
  "control-center.engineering-executive.v1" as const;

export const SOURCE_SYSTEM_GITHUB = "github" as const;

export const COLLECTOR_FRESHNESS = [
  "fresh",
  "stale",
  "failed",
  "not_modified",
  "unsupported",
] as const;

export const CANONICAL_FRESHNESS = ["FRESH", "STALE", "UNKNOWN", "ERROR"] as const;

export const HEALTH_STATUSES = ["healthy", "degraded", "down", "unknown"] as const;

export const CLAIM_KINDS = [
  "decision",
  "directive",
  "fact",
  "constraint",
  "priority",
  "risk",
  "hypothesis",
] as const;

export const ATTENTION_SEVERITIES = ["critical", "high", "medium", "low"] as const;

export const ATTENTION_STATUSES = [
  "open",
  "acknowledged",
  "resolved",
  "dismissed",
] as const;

export const BLOCKER_KINDS = [
  "stale_pr",
  "ci_red",
  "p0_issue",
  "p1_issue",
  "unknown_quiet",
] as const;

export const HYPOTHESIS_ACTIVE_WORK_WITHOUT_EVIDENCE =
  "trabalho ativo sem evidência recente" as const;

export const HYPOTHESIS_CODE = "active_work_without_recent_evidence" as const;

export const SYSTEM_ACTOR_ID = "system:engineering-read-model" as const;

export const UTC_DATETIME_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/;

export const RESOURCE_ID_PATTERN = /^cc:[a-z][a-z0-9-]*:[A-Za-z0-9._~-]+$/;

export const DEFAULT_PR_STALE_AFTER_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_FRESHNESS_WINDOW_SECONDS = 6 * 60 * 60;

export const TITLE_MAX = 200;
export const SUMMARY_MAX = 2000;
export const LABEL_MAX = 128;
export const LOCATOR_MAX = 512;
export const COMMIT_SUBJECT_MAX = 120;

export const SECRET_KEY_PATTERN =
  /^(secret|token|password|authorization|api[_-]?key|cookie|credential|private[_-]?key|pat|github_pat|github_token)$/i;

export const HUGE_BODY_KEYS = new Set([
  "diff",
  "patch",
  "files",
  "raw",
  "diff_hunk",
  "patch_text",
]);

export const FORBIDDEN_OUTPUT_SUBSTRINGS = [
  "DIFF_BODY_MUST_NOT_LEAK",
];
