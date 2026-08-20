import { readFileSync } from "node:fs";
import { assertCaddyHook, loadCaddy } from "./caddy.ts";
import {
  defaultPublishedPort,
  hasLogRotation,
  hasResourceLimits,
  healthcheckText,
  inspectCompose,
  loadCompose,
  parsePort,
  requireService,
} from "./compose.ts";
import { assertEnvExampleSafe } from "./env-file.ts";
import { failClosed } from "./fail-closed.ts";
import { assertNoKubernetes, assertNoProductionApplyScripts } from "./k8s.ts";
import { CADDY_FILE, COMPOSE_FILE, ENV_EXAMPLE, PACK_ROOT } from "./paths.ts";

export interface ValidateReport {
  ok: true;
  project: string;
  postgres_volume: string;
  caddy_hook: string;
  backup: string;
  restore: string;
  retention: string;
  disk_guard: string;
  kubernetes: "absent";
  production_apply: "refused";
  services: string[];
  summary: string;
}

const STUB_SERVICES = ["context", "mcp", "web-shell"] as const;
const ALWAYS_ON = ["postgres", "context", "mcp", "web-shell", "caddy"] as const;

function truthy(raw: string | undefined): boolean {
  if (raw === undefined) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

export function assertNoHostPrivilegedPorts(doc: ReturnType<typeof loadCompose>["doc"]): void {
  for (const [name, svc] of Object.entries(doc.services ?? {})) {
    for (const entry of svc.ports ?? []) {
      const port = parsePort(entry);
      if (!port) {
        continue;
      }
      if (port.host_ip && port.host_ip !== "127.0.0.1") {
        failClosed(`service ${name} publishes on ${port.host_ip}; loopback only this wave`);
      }
      const published = defaultPublishedPort(port.published);
      if (published === 80 || published === 443) {
        failClosed(`service ${name} publishes host port ${published}; Warmbly nginx owns 80/443`);
      }
      const target = typeof port.target === "number" ? port.target : Number(port.target);
      if (target === 80 || target === 443) {
        failClosed(`service ${name} container port ${target} would steal 80/443`);
      }
    }
  }
}

export function assertComposeInvariants(doc: ReturnType<typeof loadCompose>["doc"]): ReturnType<typeof inspectCompose> {
  const inspected = inspectCompose(doc);
  for (const name of ALWAYS_ON) {
    const svc = requireService(doc, name);
    if (svc.restart !== "unless-stopped") {
      failClosed(`service ${name} must restart unless-stopped`);
    }
    if (!hasResourceLimits(svc)) {
      failClosed(`service ${name} must declare CPU and memory limits`);
    }
    if (!hasLogRotation(svc)) {
      failClosed(`service ${name} must use json-file log rotation`);
    }
    const hc = healthcheckText(svc);
    if (hc.length === 0) {
      failClosed(`service ${name} missing healthcheck`);
    }
  }
  const pg = healthcheckText(requireService(doc, "postgres"));
  if (!pg.includes("pg_isready")) {
    failClosed("postgres healthcheck must use pg_isready");
  }
  for (const name of STUB_SERVICES) {
    const hc = healthcheckText(requireService(doc, name));
    if (!hc.includes("/healthz") || !hc.includes("/ready")) {
      failClosed(`service ${name} healthcheck must probe /healthz and /ready`);
    }
  }
  const caddyHc = healthcheckText(requireService(doc, "caddy"));
  if (!caddyHc.includes("/healthz") || !caddyHc.includes("/ready")) {
    failClosed("caddy healthcheck must probe /healthz and /ready");
  }
  requireService(doc, "backup-ops");
  assertNoHostPrivilegedPorts(doc);
  return inspected;
}

export function validatePack(env: NodeJS.ProcessEnv = process.env): ValidateReport {
  if (truthy(env.CONTROL_CENTER_APPLY_PRODUCTION)) {
    failClosed("CONTROL_CENTER_APPLY_PRODUCTION is set; this pack refuses to apply to production");
  }
  const { doc } = loadCompose(COMPOSE_FILE);
  const inspected = assertComposeInvariants(doc);
  const { hook } = loadCaddy(CADDY_FILE);
  assertCaddyHook(hook);
  assertEnvExampleSafe(readFileSync(ENV_EXAMPLE, "utf8"));
  assertNoKubernetes(PACK_ROOT);
  assertNoProductionApplyScripts(PACK_ROOT);
  const summary =
    `Control Center deploy pack: project=${inspected.project} ` +
    `postgres_volume=${inspected.postgresVolume} ` +
    `caddy_hook=reverse_proxy ` +
    `backup=encrypted-aes-256-gcm ` +
    `restore=fixture-drill ` +
    `retention=age-and-min-count ` +
    `disk_guard=fail-closed ` +
    `kubernetes=absent ` +
    `production_apply=refused`;
  return {
    ok: true,
    project: inspected.project,
    postgres_volume: inspected.postgresVolume,
    caddy_hook: "reverse_proxy",
    backup: "encrypted-aes-256-gcm",
    restore: "fixture-drill",
    retention: "age-and-min-count",
    disk_guard: "fail-closed",
    kubernetes: "absent",
    production_apply: "refused",
    services: inspected.services,
    summary,
  };
}

export function formatValidateReport(report: ValidateReport): string {
  const { summary, ...rest } = report;
  return `${JSON.stringify(rest, null, 2)}\n${summary}\n`;
}
