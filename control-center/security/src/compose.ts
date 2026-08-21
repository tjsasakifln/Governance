import { DATASTORE_NAMES, DATASTORE_PUBLIC_PORTS } from "./constants.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export interface PublishedPort {
  readonly service: string;
  readonly published: number;
  readonly hostIp: string;
}

export interface ComposeAnalysis {
  readonly published: readonly PublishedPort[];
  readonly publicDatastores: readonly string[];
  readonly datastoresMissingInternalNetwork: readonly string[];
  readonly internalNetworkDefined: boolean;
}

function parseShortPort(raw: string): { published: number; hostIp: string } | undefined {
  const trimmed = raw.trim().replace(/^"|"$/g, "");
  const parts = trimmed.split(":");
  if (parts.length === 1) {
    return undefined;
  }
  if (parts.length === 2) {
    const published = Number(parts[0]);
    if (!Number.isInteger(published)) {
      return undefined;
    }
    return { published, hostIp: "0.0.0.0" };
  }
  if (parts.length === 3) {
    const hostIp = parts[0] ?? "0.0.0.0";
    const published = Number(parts[1]);
    if (!Number.isInteger(published)) {
      return undefined;
    }
    return { published, hostIp: hostIp === "" ? "0.0.0.0" : hostIp };
  }
  return undefined;
}

function portsOf(service: Record<string, unknown>): PublishedPort[] {
  const raw = service.ports;
  if (raw === undefined) {
    return [];
  }
  const list = Array.isArray(raw) ? raw : [raw];
  const out: PublishedPort[] = [];
  for (const item of list) {
    if (typeof item === "string" || typeof item === "number") {
      const parsed = parseShortPort(String(item));
      if (parsed) {
        out.push({ service: "", ...parsed });
      }
      continue;
    }
    if (isRecord(item)) {
      const published = Number(item.published);
      if (!Number.isInteger(published)) {
        continue;
      }
      const hostIp = typeof item.host_ip === "string" && item.host_ip.length > 0 ? item.host_ip : "0.0.0.0";
      out.push({ service: "", published, hostIp });
    }
  }
  return out;
}

function isLoopback(hostIp: string): boolean {
  return hostIp === "127.0.0.1" || hostIp === "::1" || hostIp === "localhost";
}

function serviceNetworks(service: Record<string, unknown>): string[] {
  const raw = service.networks;
  if (Array.isArray(raw)) {
    return raw.filter((n): n is string => typeof n === "string");
  }
  if (isRecord(raw)) {
    return Object.keys(raw);
  }
  return [];
}

export function analyzeCompose(doc: unknown): ComposeAnalysis {
  if (!isRecord(doc) || !isRecord(doc.services)) {
    return {
      published: [],
      publicDatastores: ["compose.services is missing"],
      datastoresMissingInternalNetwork: DATASTORE_NAMES.slice(),
      internalNetworkDefined: false,
    };
  }
  const services = doc.services;
  const published: PublishedPort[] = [];
  for (const [name, svc] of Object.entries(services)) {
    if (!isRecord(svc)) {
      continue;
    }
    for (const port of portsOf(svc)) {
      published.push({ ...port, service: name });
    }
  }

  const publicDatastores: string[] = [];
  for (const port of published) {
    const kind = DATASTORE_PUBLIC_PORTS[port.published];
    if (kind === undefined) {
      continue;
    }
    if (!isLoopback(port.hostIp)) {
      publicDatastores.push(`${kind} published on ${port.hostIp}:${port.published} via ${port.service}`);
    }
  }

  const networks = isRecord(doc.networks) ? doc.networks : {};
  let internalNetworkDefined = false;
  const internalNames: string[] = [];
  for (const [name, spec] of Object.entries(networks)) {
    if (isRecord(spec) && spec.internal === true) {
      internalNetworkDefined = true;
      internalNames.push(name);
    }
  }

  const datastoresMissingInternalNetwork: string[] = [];
  for (const name of DATASTORE_NAMES) {
    const svc = services[name];
    if (!isRecord(svc)) {
      datastoresMissingInternalNetwork.push(`${name} service is missing`);
      continue;
    }
    const joined = serviceNetworks(svc);
    const onInternal = joined.some((n) => internalNames.includes(n));
    const onNonInternal = joined.some((n) => !internalNames.includes(n));
    if (!onInternal) {
      datastoresMissingInternalNetwork.push(`${name} is not on an internal:true network`);
    }
    if (onNonInternal) {
      datastoresMissingInternalNetwork.push(`${name} joins a non-internal network`);
    }
  }

  return {
    published,
    publicDatastores,
    datastoresMissingInternalNetwork,
    internalNetworkDefined,
  };
}
