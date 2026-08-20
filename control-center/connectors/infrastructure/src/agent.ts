import type {
  AgentBackup,
  AgentDisk,
  AgentDockerService,
  AgentHost,
  AgentLoad,
  AgentMemory,
  AgentPayload,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asFinite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseDisk(raw: unknown): AgentDisk | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const usedPct = asFinite(raw.used_pct);
  if (usedPct === undefined) {
    return undefined;
  }
  const disk: AgentDisk = { used_pct: usedPct };
  const usedBytes = asFinite(raw.used_bytes);
  const totalBytes = asFinite(raw.total_bytes);
  if (usedBytes !== undefined) {
    Object.assign(disk, { used_bytes: usedBytes });
  }
  if (totalBytes !== undefined) {
    Object.assign(disk, { total_bytes: totalBytes });
  }
  return disk;
}

function parseMemory(raw: unknown): AgentMemory | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const usedPct = asFinite(raw.used_pct);
  if (usedPct === undefined) {
    return undefined;
  }
  const memory: AgentMemory = { used_pct: usedPct };
  const available = asFinite(raw.available_bytes);
  const total = asFinite(raw.total_bytes);
  if (available !== undefined) {
    Object.assign(memory, { available_bytes: available });
  }
  if (total !== undefined) {
    Object.assign(memory, { total_bytes: total });
  }
  return memory;
}

function parseLoad(raw: unknown): AgentLoad | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const load1 = asFinite(raw.load_1);
  const load5 = asFinite(raw.load_5);
  const load15 = asFinite(raw.load_15);
  if (load1 === undefined || load5 === undefined || load15 === undefined) {
    return undefined;
  }
  return { load_1: load1, load_5: load5, load_15: load15 };
}

function parseDocker(raw: unknown): { services: AgentDockerService[] } | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.services)) {
    return undefined;
  }
  const services: AgentDockerService[] = [];
  for (const item of raw.services) {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.health !== "string") {
      continue;
    }
    const service: AgentDockerService = { name: item.name, health: item.health };
    const restart = asFinite(item.restart_count);
    const uptime = asFinite(item.uptime_seconds);
    if (restart !== undefined) {
      Object.assign(service, { restart_count: restart });
    }
    if (uptime !== undefined) {
      Object.assign(service, { uptime_seconds: uptime });
    }
    services.push(service);
  }
  return { services };
}

function parseBackup(raw: unknown): AgentBackup | undefined {
  if (!isRecord(raw) || typeof raw.status !== "string") {
    return undefined;
  }
  const backup: AgentBackup = { status: raw.status };
  if (typeof raw.last_success_at === "string") {
    Object.assign(backup, { last_success_at: raw.last_success_at });
  }
  return backup;
}

function parseHost(raw: unknown): AgentHost | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const host: AgentHost = {};
  const uptime = asFinite(raw.uptime_seconds);
  const restart = asFinite(raw.restart_count);
  if (uptime !== undefined) {
    Object.assign(host, { uptime_seconds: uptime });
  }
  if (restart !== undefined) {
    Object.assign(host, { restart_count: restart });
  }
  return Object.keys(host).length > 0 ? host : undefined;
}

export function parseAgentPayload(raw: unknown): AgentPayload | null {
  if (!isRecord(raw) || typeof raw.observed_at !== "string") {
    return null;
  }
  const payload: AgentPayload = { observed_at: raw.observed_at };
  const disk = parseDisk(raw.disk);
  const memory = parseMemory(raw.memory);
  const load = parseLoad(raw.load);
  const docker = parseDocker(raw.docker);
  const backup = parseBackup(raw.backup);
  const host = parseHost(raw.host);
  if (disk) {
    Object.assign(payload, { disk });
  }
  if (memory) {
    Object.assign(payload, { memory });
  }
  if (load) {
    Object.assign(payload, { load });
  }
  if (docker) {
    Object.assign(payload, { docker });
  }
  if (backup) {
    Object.assign(payload, { backup });
  }
  if (host) {
    Object.assign(payload, { host });
  }
  return payload;
}
