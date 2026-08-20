import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { failClosed } from "./fail-closed.ts";
import { FIXTURE_DUMP } from "./paths.ts";
import { backupFixtureDump, restoreTo } from "./pipeline.ts";

export interface DrillRun {
  encPath: string;
  restoredPath: string;
  restored: Buffer;
  sha256: string;
}

export interface DrillResult {
  fixturePath: string;
  fixtureBytes: number;
  run1: DrillRun;
  run2: DrillRun;
  sameContent: true;
}

function isoZ(d: Date): string {
  return d.toISOString();
}

export function runRestoreDrill(opts: {
  fixturePath?: string;
  outDir: string;
  keyRaw: string | undefined;
  now?: Date;
}): DrillResult {
  const fixturePath = opts.fixturePath ?? FIXTURE_DUMP;
  const fixture = readFileSync(fixturePath);
  if (fixture.length === 0) {
    failClosed("fixture dump is empty");
  }
  mkdirSync(opts.outDir, { recursive: true });
  const baseNow = opts.now ?? new Date();
  const runs: DrillRun[] = [];
  for (const [index, offsetMs] of [0, 1000].entries()) {
    const runDir = join(opts.outDir, `run-${index + 1}`);
    mkdirSync(runDir, { recursive: true });
    const observedAt = isoZ(new Date(baseNow.getTime() + offsetMs));
    const backup = backupFixtureDump(fixturePath, {
      keyRaw: opts.keyRaw,
      outDir: join(runDir, "backups"),
      observedAt,
      diskPath: runDir,
      minBytesRaw: "1",
      retainDaysRaw: "14",
      retainMinRaw: "3",
    });
    const restored = restoreTo(runDir, backup.encPath, opts.keyRaw, "restored.dump.sql");
    if (!restored.equals(fixture)) {
      failClosed(`restore drill run ${index + 1} does not match fixture`);
    }
    if (readFileSync(backup.encPath).equals(fixture)) {
      failClosed("restore drill wrote unencrypted archive");
    }
    writeFileSync(
      join(runDir, "drill.meta.json"),
      `${JSON.stringify(
        {
          source: "control-center.deploy.restore-drill",
          observed_at: observedAt,
          freshness_status: "fresh",
          encPath: backup.encPath,
        },
        null,
        2,
      )}\n`,
    );
    runs.push({
      encPath: backup.encPath,
      restoredPath: join(runDir, "restored.dump.sql"),
      restored,
      sha256: backup.meta.sha256_plaintext,
    });
  }
  const run1 = runs[0];
  const run2 = runs[1];
  if (!run1 || !run2) {
    failClosed("restore drill did not produce two runs");
  }
  if (!run1.restored.equals(run2.restored)) {
    failClosed("restore drill runs restored different bytes");
  }
  return {
    fixturePath,
    fixtureBytes: fixture.length,
    run1,
    run2,
    sameContent: true,
  };
}
