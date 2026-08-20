#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { composeHoje } from "./compose.js";
import { FIXTURE_NAMES, isFixtureName, loadNamedFixture } from "./fixtures.js";
import { logEvent } from "./log.js";
import { dumpViewJson, renderHojeDocument } from "./render.js";
import type { FixtureName } from "./types.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(PACKAGE_ROOT, "public");

function usage(): string {
  return `Usage:
  hoje dump <fixture>
  hoje page <fixture>
  hoje generate-public
  hoje list

Fixtures: ${FIXTURE_NAMES.join(", ")}
`;
}

function requireFixture(name: string | undefined): FixtureName {
  if (!name || !isFixtureName(name)) {
    throw new Error(usage());
  }
  return name;
}

function dump(name: FixtureName): string {
  const payload = loadNamedFixture(name);
  const view = composeHoje(payload);
  logEvent("hoje.dump", {
    fixture: view.fixture_name,
    bands: view.bands.length,
    top3: view.bands[0]?.rows.length ?? 0,
    charts_emitted: false,
  });
  return dumpViewJson(view);
}

function page(name: FixtureName): string {
  const payload = loadNamedFixture(name);
  const view = composeHoje(payload);
  logEvent("hoje.page", { fixture: view.fixture_name, bands: view.bands.length });
  return renderHojeDocument(view);
}

function generatePublic(): string {
  mkdirSync(PUBLIC_DIR, { recursive: true });
  const written: string[] = [];
  for (const name of FIXTURE_NAMES) {
    const html = page(name);
    const file = join(PUBLIC_DIR, `hoje-${name}.html`);
    writeFileSync(file, html, "utf8");
    written.push(file);
  }
  const fire = join(PUBLIC_DIR, "hoje.html");
  writeFileSync(fire, page("incendio-operacional"), "utf8");
  written.push(fire);
  logEvent("hoje.generate-public", { files: written.length, charts_emitted: false });
  return written.join("\n") + "\n";
}

export function runCli(argv: string[]): { stdout: string; code: number } {
  const cmd = argv[0];
  try {
    if (cmd === "list") {
      return { stdout: FIXTURE_NAMES.join("\n") + "\n", code: 0 };
    }
    if (cmd === "dump") {
      return { stdout: dump(requireFixture(argv[1])), code: 0 };
    }
    if (cmd === "page") {
      return { stdout: page(requireFixture(argv[1])), code: 0 };
    }
    if (cmd === "generate-public") {
      return { stdout: generatePublic(), code: 0 };
    }
    return { stdout: usage(), code: 1 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent("hoje.error", { message: message.slice(0, 200) });
    return { stdout: `${message}\n`, code: 1 };
  }
}

const invoked =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href;
if (invoked) {
  const result = runCli(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.exit(result.code);
}
