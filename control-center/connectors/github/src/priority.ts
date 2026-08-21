const PRIORITY_LABEL =
  /^(?:priority[:\s-]*)?(p[0-4]|critical|urgent|high|medium|low)$/i;

export function extractPriority(labels: readonly string[]): string | null {
  for (const name of labels) {
    const match = name.trim().match(PRIORITY_LABEL);
    const captured = match?.[1];
    if (captured) {
      return captured.toLowerCase();
    }
  }
  return null;
}

export function labelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) {
    return [];
  }
  const names: string[] = [];
  for (const item of labels) {
    if (typeof item === "string") {
      names.push(item);
      continue;
    }
    if (item !== null && typeof item === "object" && "name" in item) {
      const name = (item as { name: unknown }).name;
      if (typeof name === "string") {
        names.push(name);
      }
    }
  }
  return names;
}
