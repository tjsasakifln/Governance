import { isResourceId } from "./contract.ts";

let seq = 0;

export function resetIdSeq(value = 0): void {
  seq = value;
}

/**
 * `cc:directive:<slug>` matching contracts v1. No ULID dependency in this package.
 */
export function newDirectiveId(now: Date): string {
  seq += 1;
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const id = `cc:directive:${stamp}-${seq.toString(36)}`;
  if (!isResourceId(id)) {
    throw new Error("generated id does not match resource_id pattern");
  }
  return id;
}
