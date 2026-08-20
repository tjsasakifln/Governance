import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { failClosed } from "./fail-closed.ts";
import { COMPOSE_FILE } from "./paths.ts";

export interface ResourceLimits {
  cpus?: string;
  memory?: string;
}

export interface ComposeHealthcheck {
  test?: unknown;
  interval?: string;
  timeout?: string;
  retries?: number;
  start_period?: string;
}

export interface ComposePort {
  target?: number | string;
  published?: number | string;
  protocol?: string;
  host_ip?: string;
}

export interface ComposeService {
  restart?: string;
  image?: string;
  build?: { context?: string; dockerfile?: string };
  healthcheck?: ComposeHealthcheck;
  deploy?: { resources?: { limits?: ResourceLimits; reservations?: ResourceLimits } };
  mem_limit?: string | number;
  cpus?: string | number;
  logging?: { driver?: string; options?: Record<string, string> };
  volumes?: unknown[];
  ports?: unknown[];
  environment?: unknown;
  profiles?: unknown[];
}

export interface ComposeVolume {
  name?: string;
}

export interface ComposeDocument {
  name?: string;
  services?: Record<string, ComposeService>;
  volumes?: Record<string, ComposeVolume | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asResourceLimits(value: unknown): ResourceLimits | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const limits: ResourceLimits = {};
  if (typeof value.cpus === "string" || typeof value.cpus === "number") {
    limits.cpus = String(value.cpus);
  }
  if (typeof value.memory === "string") {
    limits.memory = value.memory;
  }
  return limits;
}

function asService(value: unknown): ComposeService {
  if (!isRecord(value)) {
    failClosed("compose service is not a mapping");
  }
  const svc: ComposeService = {};
  if (typeof value.restart === "string") {
    svc.restart = value.restart;
  }
  if (typeof value.image === "string") {
    svc.image = value.image;
  }
  if (isRecord(value.build)) {
    svc.build = {
      ...(typeof value.build.context === "string" ? { context: value.build.context } : {}),
      ...(typeof value.build.dockerfile === "string"
        ? { dockerfile: value.build.dockerfile }
        : {}),
    };
  }
  if (isRecord(value.healthcheck)) {
    const hc: ComposeHealthcheck = {};
    if (value.healthcheck.test !== undefined) {
      hc.test = value.healthcheck.test;
    }
    if (typeof value.healthcheck.interval === "string") {
      hc.interval = value.healthcheck.interval;
    }
    if (typeof value.healthcheck.timeout === "string") {
      hc.timeout = value.healthcheck.timeout;
    }
    if (typeof value.healthcheck.retries === "number") {
      hc.retries = value.healthcheck.retries;
    }
    if (typeof value.healthcheck.start_period === "string") {
      hc.start_period = value.healthcheck.start_period;
    }
    svc.healthcheck = hc;
  }
  if (isRecord(value.deploy) && isRecord(value.deploy.resources)) {
    const limits = asResourceLimits(value.deploy.resources.limits);
    const reservations = asResourceLimits(value.deploy.resources.reservations);
    svc.deploy = {
      resources: {
        ...(limits ? { limits } : {}),
        ...(reservations ? { reservations } : {}),
      },
    };
  }
  if (typeof value.mem_limit === "string" || typeof value.mem_limit === "number") {
    svc.mem_limit = value.mem_limit;
  }
  if (typeof value.cpus === "string" || typeof value.cpus === "number") {
    svc.cpus = value.cpus;
  }
  if (isRecord(value.logging)) {
    const options: Record<string, string> = {};
    if (isRecord(value.logging.options)) {
      for (const [k, v] of Object.entries(value.logging.options)) {
        if (typeof v === "string") {
          options[k] = v;
        }
      }
    }
    svc.logging = {
      ...(typeof value.logging.driver === "string" ? { driver: value.logging.driver } : {}),
      ...(Object.keys(options).length > 0 ? { options } : {}),
    };
  }
  if (Array.isArray(value.volumes)) {
    svc.volumes = value.volumes;
  }
  if (Array.isArray(value.ports)) {
    svc.ports = value.ports;
  }
  if (value.environment !== undefined) {
    svc.environment = value.environment;
  }
  if (Array.isArray(value.profiles)) {
    svc.profiles = value.profiles;
  }
  return svc;
}

export function parseComposeText(text: string): ComposeDocument {
  const parsed: unknown = parseYaml(text, { merge: true });
  if (!isRecord(parsed)) {
    failClosed("compose file is not a mapping");
  }
  const doc: ComposeDocument = {};
  if (typeof parsed.name === "string") {
    doc.name = parsed.name;
  }
  if (isRecord(parsed.services)) {
    const services: Record<string, ComposeService> = {};
    for (const [name, svc] of Object.entries(parsed.services)) {
      services[name] = asService(svc);
    }
    doc.services = services;
  }
  if (isRecord(parsed.volumes)) {
    const volumes: Record<string, ComposeVolume | null> = {};
    for (const [name, vol] of Object.entries(parsed.volumes)) {
      if (vol === null) {
        volumes[name] = null;
      } else if (isRecord(vol)) {
        volumes[name] = typeof vol.name === "string" ? { name: vol.name } : {};
      } else {
        failClosed(`compose volume ${name} is invalid`);
      }
    }
    doc.volumes = volumes;
  }
  return doc;
}

export function loadCompose(path = COMPOSE_FILE): { text: string; doc: ComposeDocument } {
  const text = readFileSync(path, "utf8");
  return { text, doc: parseComposeText(text) };
}

export function healthcheckText(svc: ComposeService | undefined): string {
  const test = svc?.healthcheck?.test;
  if (typeof test === "string") {
    return test;
  }
  if (Array.isArray(test)) {
    return test.map(String).join(" ");
  }
  return "";
}

export function parsePort(entry: unknown): ComposePort | undefined {
  if (typeof entry === "string") {
    const parts = entry.split(":");
    if (parts.length === 3) {
      return { host_ip: parts[0], published: parts[1], target: parts[2] };
    }
    if (parts.length === 2) {
      return { published: parts[0], target: parts[1] };
    }
    return { target: entry };
  }
  if (!isRecord(entry)) {
    return undefined;
  }
  const port: ComposePort = {};
  if (typeof entry.target === "number" || typeof entry.target === "string") {
    port.target = entry.target;
  }
  if (typeof entry.published === "number" || typeof entry.published === "string") {
    port.published = entry.published;
  }
  if (typeof entry.protocol === "string") {
    port.protocol = entry.protocol;
  }
  if (typeof entry.host_ip === "string") {
    port.host_ip = entry.host_ip;
  }
  return port;
}

export function defaultPublishedPort(published: string | number | undefined): number | undefined {
  if (typeof published === "number") {
    return published;
  }
  if (typeof published !== "string") {
    return undefined;
  }
  const match = published.match(/:-(\d+)\}/);
  if (match) {
    return Number(match[1]);
  }
  if (/^\d+$/.test(published)) {
    return Number(published);
  }
  return undefined;
}

export function serviceVolumeNames(svc: ComposeService | undefined): string[] {
  const vols = svc?.volumes ?? [];
  const names: string[] = [];
  for (const item of vols) {
    if (typeof item === "string") {
      const left = item.split(":")[0];
      if (left) {
        names.push(left);
      }
    } else if (isRecord(item) && typeof item.source === "string") {
      names.push(item.source);
    }
  }
  return names;
}

export function hasResourceLimits(svc: ComposeService | undefined): boolean {
  if (!svc) {
    return false;
  }
  const limits = svc.deploy?.resources?.limits;
  const mem = svc.mem_limit !== undefined || typeof limits?.memory === "string";
  const cpu = svc.cpus !== undefined || typeof limits?.cpus === "string";
  return mem && cpu;
}

export function hasLogRotation(svc: ComposeService | undefined): boolean {
  const logging = svc?.logging;
  if (!logging || logging.driver !== "json-file") {
    return false;
  }
  const maxSize = logging.options?.["max-size"];
  const maxFile = logging.options?.["max-file"];
  return typeof maxSize === "string" && typeof maxFile === "string";
}

export function requireService(
  doc: ComposeDocument,
  name: string,
): ComposeService {
  const svc = doc.services?.[name];
  if (!svc) {
    failClosed(`compose missing service ${name}`);
  }
  return svc;
}

export function inspectCompose(doc: ComposeDocument): {
  project: string;
  postgresVolume: string;
  services: string[];
} {
  const project = asString(doc.name);
  if (project !== "confenge-control-center") {
    failClosed("compose name must be confenge-control-center");
  }
  const postgres = requireService(doc, "postgres");
  const volKey = "cc_postgres_data";
  if (!serviceVolumeNames(postgres).includes(volKey)) {
    failClosed("postgres is missing persistent volume cc_postgres_data");
  }
  const named = doc.volumes?.[volKey];
  const postgresVolume = named?.name ?? volKey;
  if (postgresVolume !== "confenge-control-center-postgres") {
    failClosed("postgres volume name must be confenge-control-center-postgres");
  }
  return {
    project,
    postgresVolume,
    services: Object.keys(doc.services ?? {}),
  };
}
