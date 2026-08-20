import { readFileSync } from "node:fs";
import { RULE, THREAT_CONTROLS, THREAT_IDS, type RuleId, type ThreatId } from "./constants.js";
import { resolveInPackage } from "./paths.js";
import type { ThreatModel, ValidationIssue } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseThreatModel(raw: unknown): ThreatModel {
  if (!isRecord(raw)) {
    throw new Error("threat-model.json must be an object");
  }
  const schemaVersion = raw.schema_version;
  if (typeof schemaVersion !== "string" || schemaVersion.length === 0) {
    throw new Error("threat-model.json schema_version is required");
  }
  if (!Array.isArray(raw.threats)) {
    throw new Error("threat-model.json threats must be an array");
  }
  const threats = raw.threats.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`threats[${index}] must be an object`);
    }
    if (typeof item.id !== "string" || typeof item.title !== "string") {
      throw new Error(`threats[${index}] needs id and title`);
    }
    if (!Array.isArray(item.controls) || item.controls.some((c) => typeof c !== "string")) {
      throw new Error(`threats[${index}].controls must be string[]`);
    }
    return { id: item.id, title: item.title, controls: item.controls as string[] };
  });
  return { schemaVersion, threats };
}

export function loadThreatModelFile(): ThreatModel {
  const raw = JSON.parse(readFileSync(resolveInPackage("threat-model.json"), "utf8")) as unknown;
  return parseThreatModel(raw);
}

export function validateThreatModel(model: ThreatModel): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const byId = new Map(model.threats.map((t) => [t.id, t]));
  for (const id of THREAT_IDS) {
    const row = byId.get(id);
    if (row === undefined) {
      errors.push({
        code: "missing-threat",
        rule: RULE.FAIL_CLOSED_IDENTITY,
        path: "threat-model.json",
        message: `threat-model missing ${id}`,
      });
      continue;
    }
    const required = THREAT_CONTROLS[id as ThreatId];
    for (const control of required) {
      if (!row.controls.includes(control)) {
        errors.push({
          code: "missing-control",
          rule: control as RuleId,
          path: `threat-model.json:${id}`,
          message: `${id} must map to control ${control}`,
        });
      }
    }
  }
  return errors;
}
