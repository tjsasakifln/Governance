import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function findPackageRoot(startHref = import.meta.url): string {
  let dir = dirname(fileURLToPath(startHref));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "fixtures"))) {
      return dir;
    }
    dir = join(dir, "..");
  }
  throw new Error("infrastructure collector package root not found");
}
