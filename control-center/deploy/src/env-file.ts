import { failClosed } from "./fail-closed.ts";

export interface EnvAssignment {
  name: string;
  value: string;
  line: number;
}

const REQUIRED_NAMES = [
  "COMPOSE_PROJECT_NAME",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "CONTROL_CENTER_DATABASE_URL",
  "CONTROL_CENTER_BACKUP_KEY",
  "CONTROL_CENTER_BACKUP_DIR",
  "CONTROL_CENTER_BACKUP_RETAIN_DAYS",
  "CONTROL_CENTER_BACKUP_RETAIN_MIN",
  "CONTROL_CENTER_DISK_MIN_BYTES",
  "CONTROL_CENTER_DISK_PATH",
  "CONTROL_CENTER_FOUNDER_ACTOR_ID",
  "CONFENGE_MCP_AUTH_TOKEN",
  "CONTROL_CENTER_PUBLIC_HOST",
  "CONTROL_CENTER_CADDY_HTTP_PORT",
  "CONTROL_CENTER_CADDY_HTTPS_PORT",
  "STUB_READY",
  "CONTROL_CENTER_APPLY_PRODUCTION",
] as const;

export const ENV_EXAMPLE_REQUIRED_NAMES: readonly string[] = REQUIRED_NAMES;

export function parseEnvExample(text: string): EnvAssignment[] {
  const out: EnvAssignment[] = [];
  const lines = text.split(/\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      failClosed(`invalid .env.example line ${index + 1}`);
    }
    const name = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    const hash = value.indexOf(" #");
    if (hash >= 0) {
      value = value.slice(0, hash);
    }
    value = value.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.push({ name, value, line: index + 1 });
  }
  return out;
}

export function looksLikeSecret(value: string): boolean {
  const v = value.trim();
  if (v.length === 0) {
    return false;
  }
  if (/^postgres:\/\//i.test(v)) {
    return /:([^:@/]+)@/.test(v);
  }
  if (/^[0-9]+$/.test(v)) {
    return false;
  }
  if (/^(true|false)$/i.test(v)) {
    return false;
  }
  if (v.startsWith("eyJ")) {
    return true;
  }
  if (/^[0-9a-f]{32,}$/i.test(v)) {
    return true;
  }
  if (/^[A-Za-z0-9+/]{40,}={0,2}$/.test(v) && /[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v)) {
    return true;
  }
  if (v.length >= 24 && /[A-Za-z]/.test(v) && /\d/.test(v) && !/[./:_-]/.test(v)) {
    return true;
  }
  return false;
}

export function assertEnvExampleSafe(text: string): EnvAssignment[] {
  const assignments = parseEnvExample(text);
  const names = new Set(assignments.map((a) => a.name));
  for (const required of REQUIRED_NAMES) {
    if (!names.has(required)) {
      failClosed(`.env.example missing ${required}`);
    }
  }
  for (const row of assignments) {
    if (looksLikeSecret(row.value)) {
      failClosed(`.env.example line ${row.line} looks like a live secret (${row.name})`);
    }
  }
  const apply = assignments.find((a) => a.name === "CONTROL_CENTER_APPLY_PRODUCTION");
  if (apply && apply.value !== "false" && apply.value !== "0") {
    failClosed("CONTROL_CENTER_APPLY_PRODUCTION must be false in .env.example");
  }
  const project = assignments.find((a) => a.name === "COMPOSE_PROJECT_NAME");
  if (project && project.value !== "confenge-control-center") {
    failClosed("COMPOSE_PROJECT_NAME must be confenge-control-center");
  }
  return assignments;
}
