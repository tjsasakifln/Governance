import path from "node:path";
import { fileURLToPath } from "node:url";

export function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function resolveInPackage(...segments: string[]): string {
  return path.join(packageRoot(), ...segments);
}

export function validExampleDir(): string {
  return resolveInPackage("examples", "valid");
}

export function invalidExampleDir(name: string): string {
  return resolveInPackage("examples", "invalid", name);
}
