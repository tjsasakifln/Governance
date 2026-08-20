CREATE TABLE control_center.current_directives (
  directive_id TEXT PRIMARY KEY REFERENCES control_center.directives (id),
  revision_id TEXT NOT NULL REFERENCES control_center.directive_revisions (id),
  kind TEXT NOT NULL CHECK (kind IN ('decision', 'directive', 'fact', 'constraint', 'priority', 'risk', 'hypothesis')),
  scope TEXT NOT NULL CHECK (control_center.is_scope(scope)),
  status TEXT NOT NULL CHECK (control_center.is_directive_status(status)),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 512),
  effective_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  source_kind TEXT NOT NULL CHECK (control_center.is_source_kind(source_kind)),
  source_locator TEXT NOT NULL CHECK (char_length(btrim(source_locator)) BETWEEN 1 AND 512),
  source_label TEXT CHECK (source_label IS NULL OR char_length(btrim(source_label)) BETWEEN 1 AND 128),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (control_center.is_freshness(freshness_status)),
  confidence NUMERIC(5, 4) NOT NULL CHECK (control_center.is_confidence(confidence)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX current_directives_scope_status_idx
  ON control_center.current_directives (scope, status, kind);

CREATE TABLE control_center.current_attention_items (
  attention_item_id TEXT PRIMARY KEY REFERENCES control_center.attention_items (id),
  scope TEXT NOT NULL CHECK (control_center.is_scope(scope)),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  title TEXT NOT NULL,
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  source_kind TEXT NOT NULL CHECK (control_center.is_source_kind(source_kind)),
  source_locator TEXT NOT NULL CHECK (char_length(btrim(source_locator)) BETWEEN 1 AND 512),
  source_label TEXT CHECK (source_label IS NULL OR char_length(btrim(source_label)) BETWEEN 1 AND 128),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (control_center.is_freshness(freshness_status)),
  confidence NUMERIC(5, 4) NOT NULL CHECK (control_center.is_confidence(confidence)),
  money_amount_cents BIGINT,
  money_currency CHAR(3),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX current_attention_items_scope_status_idx
  ON control_center.current_attention_items (scope, status, severity);

CREATE TABLE control_center.current_source_observations (
  source_system TEXT NOT NULL CHECK (control_center.is_source_system(source_system)),
  source_kind TEXT NOT NULL CHECK (control_center.is_source_kind(source_kind)),
  source_locator TEXT NOT NULL CHECK (char_length(btrim(source_locator)) BETWEEN 1 AND 512),
  scope TEXT NOT NULL CHECK (control_center.is_scope(scope)),
  observation_id TEXT NOT NULL REFERENCES control_center.source_observations (id),
  observed_at TIMESTAMPTZ NOT NULL,
  freshness_status TEXT NOT NULL CHECK (control_center.is_freshness(freshness_status)),
  confidence NUMERIC(5, 4) NOT NULL CHECK (control_center.is_confidence(confidence)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_system, source_kind, source_locator, scope)
);

CREATE MATERIALIZED VIEW control_center.mv_open_attention AS
SELECT
  id,
  scope,
  severity,
  title,
  status,
  source_system,
  source_kind,
  source_locator,
  source_label,
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
