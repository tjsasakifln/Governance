CREATE TABLE control_center.current_directives (
  directive_id UUID PRIMARY KEY REFERENCES control_center.directives (id),
  revision_id UUID NOT NULL REFERENCES control_center.directive_revisions (id),
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'directive', 'fact', 'constraint', 'priority', 'risk', 'hypothesis')),
  scope TEXT NOT NULL CHECK (char_length(btrim(scope)) BETWEEN 1 AND 256),
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded', 'expired', 'withdrawn')),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 512),
  effective_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  supersedes UUID,
  created_by TEXT NOT NULL,
  source TEXT NOT NULL CHECK (char_length(btrim(source)) BETWEEN 1 AND 256),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (freshness_status IN ('fresh', 'stale', 'unknown', 'expired')),
  confidence NUMERIC(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX current_directives_scope_status_idx
  ON control_center.current_directives (scope, status, kind);

CREATE TABLE control_center.current_attention_items (
  attention_item_id UUID PRIMARY KEY REFERENCES control_center.attention_items (id),
  scope TEXT NOT NULL CHECK (char_length(btrim(scope)) BETWEEN 1 AND 256),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  title TEXT NOT NULL,
  source TEXT NOT NULL CHECK (char_length(btrim(source)) BETWEEN 1 AND 256),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (freshness_status IN ('fresh', 'stale', 'unknown', 'expired')),
  confidence NUMERIC(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  money_amount_cents BIGINT,
  money_currency CHAR(3),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX current_attention_items_scope_status_idx
  ON control_center.current_attention_items (scope, status, severity);

CREATE TABLE control_center.current_source_observations (
  source TEXT NOT NULL CHECK (char_length(btrim(source)) BETWEEN 1 AND 256),
  scope TEXT NOT NULL CHECK (char_length(btrim(scope)) BETWEEN 1 AND 256),
  observation_id UUID NOT NULL REFERENCES control_center.source_observations (id),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (freshness_status IN ('fresh', 'stale', 'unknown', 'expired')),
  confidence NUMERIC(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, scope)
);

CREATE MATERIALIZED VIEW control_center.mv_open_attention AS
SELECT
  id,
  scope,
  severity,
  title,
  status,
  source,
  observed_at,
  freshness_status,
  confidence,
  money_amount_cents,
  money_currency
FROM control_center.attention_items
WHERE status IN ('open', 'acknowledged');

CREATE UNIQUE INDEX mv_open_attention_id_idx
  ON control_center.mv_open_attention (id);

CREATE INDEX mv_open_attention_scope_severity_idx
  ON control_center.mv_open_attention (scope, severity);
