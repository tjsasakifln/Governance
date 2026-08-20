import { BlockList, isIP } from "node:net";

export function normalizeRemoteAddress(raw: string): string {
  let value = raw.trim();
  if (value.startsWith("[") && value.includes("]")) {
    value = value.slice(1, value.indexOf("]"));
  } else {
    const ipv4Port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/;
    const match = ipv4Port.exec(value);
    const ip = match?.[1];
    if (ip !== undefined) {
      value = ip;
    }
  }
  if (value.toLowerCase().startsWith("::ffff:")) {
    const mapped = value.slice(7);
    if (isIP(mapped) === 4) {
      return mapped;
    }
  }
  return value;
}

export function parseCidr(cidr: string): {
  address: string;
  prefix: number;
  type: "ipv4" | "ipv6";
} {
  const trimmed = cidr.trim();
  const slash = trimmed.lastIndexOf("/");
  if (slash <= 0) {
    const version = isIP(trimmed);
    if (version === 4) {
      return { address: trimmed, prefix: 32, type: "ipv4" };
    }
    if (version === 6) {
      return { address: trimmed, prefix: 128, type: "ipv6" };
    }
    throw new Error(`invalid hop CIDR: ${cidr}`);
  }
  const address = trimmed.slice(0, slash);
  const prefix = Number(trimmed.slice(slash + 1));
  const version = isIP(address);
  if (version === 4 && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32) {
    return { address, prefix, type: "ipv4" };
  }
  if (version === 6 && Number.isInteger(prefix) && prefix >= 0 && prefix <= 128) {
    return { address, prefix, type: "ipv6" };
  }
  throw new Error(`invalid hop CIDR: ${cidr}`);
}

/**
 * Immediate TCP peer only. X-Forwarded-For / X-Real-IP are never consulted.
 * Empty CIDR list is fail-closed.
 */
export function isTrustedHop(remoteAddress: string, cidrs: readonly string[]): boolean {
  if (cidrs.length === 0) {
    return false;
  }
  const ip = normalizeRemoteAddress(remoteAddress);
  const version = isIP(ip);
  if (version === 0) {
    return false;
  }
  const type = version === 4 ? "ipv4" : "ipv6";
  const list = new BlockList();
  for (const cidr of cidrs) {
    const parsed = parseCidr(cidr);
    list.addSubnet(parsed.address, parsed.prefix, parsed.type);
  }
  return list.check(ip, type);
}
