import { randomUUID } from "node:crypto";

export interface IdGenerator {
  next(): string;
}

export const cryptoIds: IdGenerator = {
  next(): string {
    return randomUUID();
  },
};

export function sequentialIds(prefix: string): IdGenerator {
  let n = 0;
  return {
    next(): string {
      n += 1;
      return `${prefix}-${String(n).padStart(4, "0")}`;
    },
  };
}
