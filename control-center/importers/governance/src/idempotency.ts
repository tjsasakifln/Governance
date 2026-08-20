import { sha256Hex } from "./hash.js";
import type { DirectiveKind } from "./types.js";

/**
 * Stable identity for a candidate: path + kind + section index + content hash +
 * commit SHA. Re-running the same snapshot yields the same key and id.
 */
export function idempotencyKey(input: {
  sourcePath: string;
  kind: DirectiveKind;
  index: number;
  contentHash: string;
  commitSha: string;
}): string {
  return [
    "gov-import",
    input.sourcePath,
    input.kind,
    String(input.index),
    input.contentHash,
    input.commitSha,
  ].join(":");
}

export function candidateId(key: string): string {
  return `cc:directive:gov-${sha256Hex(key).slice(0, 26)}`;
}
