-- TEST CONTRACT ONLY of PersistencePort records.
-- This file is a snapshot for tests. The service MUST NOT load, parse, or
-- apply it at runtime. Do not treat it as a second authority or a live
-- migration. Timestamps are timestamptz (UTC). Money is not stored here.

CREATE TABLE IF NOT EXISTS cc_directive_revisions (
  revision_id TEXT PRIMARY KEY,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'decision', 'directive', 'fact', 'constraint', 'priority', 'risk', 'hypothesis'
  )),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded', 'revoked', 'expired')),
  effective_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  supersedes TEXT[],
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('human', 'agent', 'system')),
  created_by_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  source_system TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_locator TEXT NOT NULL,
  source_label TEXT,
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (freshness_status IN ('FRESH', 'STALE', 'UNKNOWN', 'ERROR')),
  confidence DOUBLE PRECISION NOT NULL,
  UNIQUE (id, version)
);

CREATE TABLE IF NOT EXISTS cc_directive_current (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES cc_directive_revisions (revision_id)
);

CREATE TABLE IF NOT EXISTS cc_audit_events (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human', 'agent', 'system')),
  actor_id TEXT NOT NULL,
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
  scope TEXT NOT NULL,
  target_directive_id TEXT,
  rationale TEXT NOT NULL,
  created_by_kind TEXT NOT NULL CHECK (created_by_kind IN ('human', 'agent', 'system')),
  created_by_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  source_system TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_locator TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (freshness_status IN ('FRESH', 'STALE', 'UNKNOWN', 'ERROR')),
  confidence DOUBLE PRECISION NOT NULL
);

-- Persistence MUST insert the audit row in the same transaction as the
-- directive/proposal mutation.
