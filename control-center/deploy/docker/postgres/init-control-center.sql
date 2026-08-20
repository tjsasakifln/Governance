-- Control Center PostgreSQL bootstrap (deploy pack).
-- Tables are owned by control-center/persistence (later convergence).
-- This file only reserves the schema so the cluster is ready for migrations.

CREATE SCHEMA IF NOT EXISTS control_center;
COMMENT ON SCHEMA control_center IS
  'Aggregated operational state and structured strategic memory. Persistence workstream owns tables.';
