#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { projectWorkOrder } from "./project.js";

const path = process.argv[2];
const observedAt = process.argv[3];
if (path === undefined || observedAt === undefined) {
  process.stderr.write("usage: npm run project -- <work-order.json> <observed-at>\n");
  process.exit(2);
}
const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
process.stdout.write(`${JSON.stringify(projectWorkOrder(raw, observedAt))}\n`);
