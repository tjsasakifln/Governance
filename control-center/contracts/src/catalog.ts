import { readFileSync } from "node:fs";
import path from "node:path";
import { packageRoot } from "./paths.js";
import {
  RESOURCE_TYPE_NAMES,
  type ResourceTypeName,
} from "./taxonomy.js";

export interface CatalogType {
  name: ResourceTypeName;
  schema_version: string;
  id_type: string;
  schema: string;
  valid_fixture: string;
  invalid_fixture: string;
}

export interface Catalog {
  package: string;
  schema_family: string;
  release: string;
  id_convention: string;
  datetime: string;
  money: string;
  types: CatalogType[];
}

let cached: Catalog | undefined;

export function loadCatalog(): Catalog {
  if (cached !== undefined) {
    return cached;
  }
  const raw = readFileSync(path.join(packageRoot(), "catalog.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!isCatalog(parsed)) {
    throw new Error("catalog.json is malformed");
  }
  if (parsed.types.length !== RESOURCE_TYPE_NAMES.length) {
    throw new Error(
      `catalog.json must list exactly ${RESOURCE_TYPE_NAMES.length} types`,
    );
  }
  cached = parsed;
  return parsed;
}

export function catalogType(name: ResourceTypeName): CatalogType {
  const found = loadCatalog().types.find((t) => t.name === name);
  if (found === undefined) {
    throw new Error(`unknown catalog type: ${name}`);
  }
  return found;
}

export function schemaVersionToType(version: string): ResourceTypeName | undefined {
  const found = loadCatalog().types.find((t) => t.schema_version === version);
  return found?.name;
}

function isCatalog(value: unknown): value is Catalog {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  if (!Array.isArray(rec.types)) {
    return false;
  }
  const names = new Set<string>(RESOURCE_TYPE_NAMES);
  for (const t of rec.types) {
    if (typeof t !== "object" || t === null) {
      return false;
    }
    const row = t as Record<string, unknown>;
    if (typeof row.name !== "string" || !names.has(row.name)) {
      return false;
    }
    if (
      typeof row.schema_version !== "string" ||
      typeof row.id_type !== "string" ||
      typeof row.schema !== "string" ||
      typeof row.valid_fixture !== "string" ||
      typeof row.invalid_fixture !== "string"
    ) {
      return false;
    }
  }
  return (
    typeof rec.package === "string" &&
    typeof rec.schema_family === "string" &&
    typeof rec.release === "string" &&
    typeof rec.id_convention === "string" &&
    typeof rec.datetime === "string" &&
    typeof rec.money === "string"
  );
}
