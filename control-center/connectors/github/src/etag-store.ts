import type { EtagRecord, EtagStore } from "./types.js";

export class MemoryEtagStore implements EtagStore {
  private readonly records = new Map<string, EtagRecord>();

  get(url: string): EtagRecord | undefined {
    return this.records.get(canonicalUrl(url));
  }

  set(url: string, record: EtagRecord): void {
    this.records.set(canonicalUrl(url), record);
  }

  size(): number {
    return this.records.size;
  }
}

function canonicalUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}
