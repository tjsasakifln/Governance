#!/usr/bin/env node
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(join(app, "performance-budgets.json"), "utf8"));
const assetDir = join(app, "dist/assets");
const assets = readdirSync(assetDir).map((name) => {
  const content = readFileSync(join(assetDir, name));
  return {
    name,
    kind: name.endsWith(".js") ? "javascript" : name.endsWith(".css") ? "css" : "other",
    raw_bytes: content.byteLength,
    gzip_bytes: gzipSync(content).byteLength,
  };
});

function total(kind, field) {
  return assets
    .filter((asset) => asset.kind === kind)
    .reduce((sum, asset) => sum + asset[field], 0);
}

const measured = {
  javascript_raw_bytes: total("javascript", "raw_bytes"),
  javascript_gzip_bytes: total("javascript", "gzip_bytes"),
  css_raw_bytes: total("css", "raw_bytes"),
  css_gzip_bytes: total("css", "gzip_bytes"),
};
measured.bundle_gzip_bytes = measured.javascript_gzip_bytes + measured.css_gzip_bytes;

const violations = Object.entries(measured)
  .filter(([metric, value]) => value > config.budgets[metric])
  .map(([metric, value]) => ({ metric, measured: value, budget: config.budgets[metric] }));
const report = {
  schema_version: "control-center.performance-build-report.v1",
  release_sha: process.env.GITHUB_SHA || process.env.CC_RELEASE_SHA || "LOCAL",
  execution: "ISOLATED_BUILD",
  assets,
  measured,
  budgets: config.budgets,
  violations,
  result: violations.length === 0 ? "PASS" : "FAIL",
};

const reportPath = process.env.CC_PERFORMANCE_BUILD_REPORT;
if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`performance_build=${report.result} js_gzip=${measured.javascript_gzip_bytes} css_gzip=${measured.css_gzip_bytes} bundle_gzip=${measured.bundle_gzip_bytes}`);
if (violations.length > 0) {
  console.error(JSON.stringify(violations));
  process.exit(1);
}
