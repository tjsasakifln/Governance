-- Confenge Control Center fixture dump (synthetic, PII-free).
-- Used by the encrypted backup → verify → restore drill. Not production data.
-- source=control-center.deploy.fixture observed_at=2026-01-01T00:00:00Z freshness_status=fresh

CREATE SCHEMA IF NOT EXISTS control_center;

-- Sentinel used by contract tests to prove round-trip restore equality.
-- CC_FIXTURE_SENTINEL_9f3c2a7b1e44

INSERT INTO control_center.directives (id, kind, scope, status)
VALUES ('cc:directive:fixture-01', 'priority', 'company', 'active');
