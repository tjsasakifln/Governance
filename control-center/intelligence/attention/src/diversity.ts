import type { SignalDomain } from "./taxonomy.js";

/**
 * Greedy domain-diverse top-N.
 *
 * Walks a pre-sorted list (total order already applied). Slot 1 is always
 * the global best. Each later slot prefers the best remaining item whose
 * domain is not yet represented. If no unused domain remains, fill with the
 * next best item. Same-domain bags therefore still fill N; mixed bags cannot
 * produce three identical domains while another domain is eligible.
 */
export function diverseTopN<T extends { domain: SignalDomain; id: string }>(
  ordered: readonly T[],
  n: number,
): T[] {
  if (n <= 0) {
    return [];
  }
  const picked: T[] = [];
  const usedIdx = new Set<number>();
  while (picked.length < n) {
    const usedDomains = new Set(picked.map((p) => p.domain));
    let found = -1;
    for (let i = 0; i < ordered.length; i += 1) {
      if (usedIdx.has(i)) {
        continue;
      }
      const item = ordered[i];
      if (item === undefined) {
        continue;
      }
      if (!usedDomains.has(item.domain)) {
        found = i;
        break;
      }
    }
    if (found === -1) {
      for (let i = 0; i < ordered.length; i += 1) {
        if (!usedIdx.has(i)) {
          found = i;
          break;
        }
      }
    }
    if (found === -1) {
      break;
    }
    const chosen = ordered[found];
    if (chosen === undefined) {
      break;
    }
    usedIdx.add(found);
    picked.push(chosen);
  }
  return picked;
}
