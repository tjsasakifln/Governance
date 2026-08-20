import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SRC_DIR = dirname(fileURLToPath(import.meta.url));
export const PACK_ROOT = dirname(SRC_DIR);

export const COMPOSE_FILE = join(PACK_ROOT, "docker-compose.yml");
export const CADDY_FILE = join(PACK_ROOT, "Caddyfile");
export const ENV_EXAMPLE = join(PACK_ROOT, ".env.example");
export const FIXTURE_DUMP = join(PACK_ROOT, "fixtures", "postgres.dump.sql");
export const LOGROTATE_FILE = join(PACK_ROOT, "docker", "logrotate.control-center.conf");
