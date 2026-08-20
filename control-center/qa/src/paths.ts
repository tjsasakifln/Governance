import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..");
}

export function fixturesDir(): string {
  return join(packageRoot(), "fixtures");
}

export function matrixDir(): string {
  return join(packageRoot(), "matrix");
}

export function docsDir(): string {
  return join(packageRoot(), "docs");
}
