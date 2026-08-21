#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { runLiveGate } from "../../../qa/src/index.ts";
import { collectAndStop } from "./snapshot.ts";

const outPath = process.argv[2];
const { snapshot } = await collectAndStop();
const report = runLiveGate(snapshot);
const printed = `${JSON.stringify(report, null, 2)}\n`;
process.stdout.write(printed);
if (outPath) {
  writeFileSync(outPath, printed);
}
process.exitCode = report.READY_FOR_INTERNAL_PRODUCTION ? 0 : 2;
