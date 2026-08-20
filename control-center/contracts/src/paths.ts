import path from "node:path";
import { fileURLToPath } from "node:url";

export function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function resolveInPackage(...segments: string[]): string {
  return path.join(packageRoot(), ...segments);
}
