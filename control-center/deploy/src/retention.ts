import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { parseBackupMeta } from "./backup.ts";
import { failClosed } from "./fail-closed.ts";

export interface RetentionEntry {
  encPath: string;
  metaPath: string;
  observedAt: Date;
}

export interface RetentionPlan {
  keep: RetentionEntry[];
  drop: RetentionEntry[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseRetainDays(raw: string | undefined, fallback = 14): number {
  const n = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    failClosed("CONTROL_CENTER_BACKUP_RETAIN_DAYS must be an integer >= 1");
  }
  return n;
}

export function parseRetainMin(raw: string | undefined, fallback = 3): number {
  const n = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    failClosed("CONTROL_CENTER_BACKUP_RETAIN_MIN must be an integer >= 1");
  }
  return n;
}

export function planRetention(
  entries: RetentionEntry[],
  now: Date,
  retainDays: number,
  retainMin: number,
): RetentionPlan {
  if (retainDays < 1 || retainMin < 1) {
    failClosed("retention retainDays and retainMin must be >= 1");
  }
  const sorted = [...entries].sort(
    (a, b) => b.observedAt.getTime() - a.observedAt.getTime(),
  );
  const cutoff = now.getTime() - retainDays * MS_PER_DAY;
  const keep = new Set<RetentionEntry>();
  for (const [index, entry] of sorted.entries()) {
    if (index < retainMin || entry.observedAt.getTime() >= cutoff) {
      keep.add(entry);
    }
  }
  return {
    keep: sorted.filter((e) => keep.has(e)),
    drop: sorted.filter((e) => !keep.has(e)),
  };
}

export function listBackupEntries(dir: string): RetentionEntry[] {
  const names = readdirSync(dir);
  const entries: RetentionEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".dump.enc")) {
      continue;
    }
    const encPath = join(dir, name);
    const metaPath = `${encPath}.meta.json`;
    if (!names.includes(`${name}.meta.json`)) {
      failClosed(`backup missing meta sidecar: ${name}`);
    }
    const meta = parseBackupMeta(readFileSync(metaPath, "utf8"));
    const observedAt = new Date(meta.observed_at);
    if (Number.isNaN(observedAt.getTime())) {
      failClosed(`backup meta observed_at is not a date: ${name}`);
    }
    entries.push({ encPath, metaPath, observedAt });
  }
  return entries;
}

export function pruneBackupDir(
  dir: string,
  now: Date,
  retainDays: number,
  retainMin: number,
): { kept: string[]; dropped: string[] } {
  const plan = planRetention(listBackupEntries(dir), now, retainDays, retainMin);
  for (const entry of plan.drop) {
    unlinkSync(entry.encPath);
    unlinkSync(entry.metaPath);
  }
  return {
    kept: plan.keep.map((e) => e.encPath),
    dropped: plan.drop.map((e) => e.encPath),
  };
}
