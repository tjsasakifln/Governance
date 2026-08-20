import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_NAMES, type FixtureName, type HojePayload } from "./types.js";
import { validatePayload } from "./validate.js";

export { FIXTURE_NAMES };
export type { FixtureName };

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

export function fixturesDir(): string {
  return FIXTURES_DIR;
}

export function isFixtureName(value: string): value is FixtureName {
  return (FIXTURE_NAMES as readonly string[]).includes(value);
}

export function loadNamedFixture(name: string): HojePayload {
  if (!isFixtureName(name)) {
    throw new Error(`unknown fixture: ${name}`);
  }
  const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), "utf8");
  const parsed = JSON.parse(raw) as HojePayload;
  if (parsed.fixture_name !== name) {
    throw new Error(`fixture_name mismatch: file ${name} vs payload ${parsed.fixture_name}`);
  }
  return validatePayload(parsed);
}

export function listFixtureFiles(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

export function loadAllFixtures(): Record<FixtureName, HojePayload> {
  const out = {} as Record<FixtureName, HojePayload>;
  for (const name of FIXTURE_NAMES) {
    out[name] = loadNamedFixture(name);
  }
  return out;
}
