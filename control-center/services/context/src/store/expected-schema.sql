-- Expected PostgreSQL surface for control-center/persistence (convergence).
-- This file is a contract, not a live migration. Do not apply it from this
-- workstream. Timestamps are timestamptz (UTC). Money is not stored here.

CREATE TABLE IF NOT EXISTS cc_directive_revisions (
  revision_id TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'decision', 'directive', 'fact', 'constraint', 'priority', 'risk', 'hypothesis'
  )),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  scope_company TEXT NOT NULL,
  scope_domain TEXT,
  scope_resource TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'expired', 'superseded')),
  effective_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  supersedes TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (freshness_status IN ('fresh', 'stale', 'unknown')),
  confidence DOUBLE PRECISION,
  UNIQUE (id, version)
);

CREATE TABLE IF NOT EXISTS cc_directive_current (
  id TEXT PRIMARY KEY REFERENCES cc_directive_revisions (id),
  revision_id TEXT NOT NULL REFERENCES cc_directive_revisions (revision_id)
);

CREATE TABLE IF NOT EXISTS cc_audit_events (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('founder', 'agent')),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('directive', 'proposal')),
  entity_id TEXT NOT NULL,
  revision_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS cc_proposals (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'rejected')),
  action TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  scope_company TEXT NOT NULL,
  scope_domain TEXT,
  scope_resource TEXT,
  target_directive_id TEXT,
  rationale TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL,
  confidence DOUBLE PRECISION
);

-- Persistence MUST insert the audit row in the same transaction as the
-- directive/proposal mutation.
