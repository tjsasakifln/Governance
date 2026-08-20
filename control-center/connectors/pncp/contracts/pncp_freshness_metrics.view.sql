-- Contract only. This workstream does not create or query extra-cli tables.
-- Later convergence should expose a read-only view (or equivalent health API)
-- with these columns so Control Center can classify without recrawling PNCP.
--
-- Mapping from extra-cli freshness_gate.py / opportunity_intel:
--   last_success_at          ← ingestion_runs completed timestamp
--   last_item_observed_at    ← MAX(ingested_at) (alias: last_ingested_at)
--   source_max_timestamp     ← MAX(data_publicacao) (alias: latest_business_date)
--   recent_window_count      ← COUNT(*) in recent window (alias: recent_records)
--   consecutive_errors       ← extra-cli does not yet emit this; required for FRESH
--   collector_heartbeat_at   ← last collector heartbeat / run start
--   lag_seconds              ← now - source_max_timestamp (optional; computed)
--   credential_status        ← available | unavailable | unknown
--
-- SELECT
--   'pncp'::text                         AS source,
--   last_success_at,
--   last_ingested_at                     AS last_item_observed_at,
--   latest_business_date                 AS source_max_timestamp,
--   recent_records                       AS recent_window_count,
--   consecutive_errors,
--   collector_heartbeat_at,
--   EXTRACT(EPOCH FROM (now() AT TIME ZONE 'utc' - source_max_timestamp))::int
--                                        AS lag_seconds,
--   credential_status
-- FROM pncp_freshness_metrics;

SELECT
  NULL::text        AS source,
  NULL::timestamptz AS last_success_at,
  NULL::timestamptz AS last_item_observed_at,
  NULL::timestamptz AS source_max_timestamp,
  NULL::integer     AS recent_window_count,
  NULL::integer     AS consecutive_errors,
  NULL::timestamptz AS collector_heartbeat_at,
  NULL::integer     AS lag_seconds,
  NULL::text        AS credential_status
WHERE false;
