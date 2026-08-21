import assert from "node:assert/strict";
import { test } from "node:test";
import { FailClosedError } from "../src/fail-closed.ts";
import { formatValidateReport, validatePack } from "../src/validate.ts";

test("validatePack reports compose project, postgres volume, caddy, backup, retention, disk guard", () => {
  const report = validatePack({ CONTROL_CENTER_APPLY_PRODUCTION: "false" });
  assert.equal(report.ok, true);
  assert.equal(report.project, "confenge-control-center");
  assert.equal(report.postgres_volume, "confenge-control-center-postgres");
  assert.equal(report.caddy_hook, "reverse_proxy");
  assert.equal(report.backup, "encrypted-aes-256-gcm");
  assert.equal(report.restore, "fixture-drill");
  assert.equal(report.retention, "age-and-min-count");
  assert.equal(report.disk_guard, "fail-closed");
  assert.equal(report.kubernetes, "absent");
  assert.equal(report.production_apply, "refused");
  assert.match(report.summary, /project=confenge-control-center/);
  assert.match(report.summary, /postgres_volume=confenge-control-center-postgres/);
  assert.match(report.summary, /caddy_hook=reverse_proxy/);
  assert.match(report.summary, /backup=encrypted-aes-256-gcm/);
  assert.match(report.summary, /restore=fixture-drill/);
  assert.match(report.summary, /retention=age-and-min-count/);
  assert.match(report.summary, /disk_guard=fail-closed/);
  const rendered = formatValidateReport(report);
  assert.match(rendered, /confenge-control-center/);
  assert.throws(
    () => validatePack({ CONTROL_CENTER_APPLY_PRODUCTION: "true" }),
    FailClosedError,
  );
});
