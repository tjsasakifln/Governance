import { existsSync, statfsSync } from "node:fs";
import { failClosed } from "./fail-closed.ts";

export interface DiskStat {
  bavail: number;
  bsize: number;
}

export type DiskStatFn = (path: string) => DiskStat;

export function parseMinBytes(raw: string | undefined, fallback = 1_073_741_824): number {
  const n = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    failClosed("CONTROL_CENTER_DISK_MIN_BYTES must be an integer >= 1");
  }
  return n;
}

export function freeBytes(stat: DiskStat): number {
  if (stat.bavail < 0 || stat.bsize <= 0) {
    failClosed("disk stat is invalid");
  }
  return stat.bavail * stat.bsize;
}

export function defaultStatFn(path: string): DiskStat {
  const stat = statfsSync(path);
  return { bavail: stat.bavail, bsize: stat.bsize };
}

export function assertDiskSpace(opts: {
  path: string;
  minBytes: number;
  statFn?: DiskStatFn;
}): { ok: true; path: string; freeBytes: number; minBytes: number } {
  if (!existsSync(opts.path)) {
    failClosed(`disk path missing: ${opts.path}`);
  }
  const statFn = opts.statFn ?? defaultStatFn;
  const free = freeBytes(statFn(opts.path));
  if (free < opts.minBytes) {
    failClosed(
      `insufficient disk: ${free} bytes free at ${opts.path}, need ${opts.minBytes}`,
    );
  }
  return { ok: true, path: opts.path, freeBytes: free, minBytes: opts.minBytes };
}
