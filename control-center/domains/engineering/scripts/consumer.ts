/**
 * Fresh consumer of the shipped engineering read-model package.
 * Not a test file. Loads the four named fixtures, calls the company-wide
 * attention/aggregation entry, and asserts the returned value.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleCollectorSnapshots,
  buildCompanyEngineeringReadModel,
  serializeReadModel,
} from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date("2026-08-20T12:00:00.000Z");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(root, "fixtures", name), "utf8"));
}

function fail(message: string): never {
  process.stdout.write(`FAIL ${message}\n`);
  process.exit(1);
}

const assembled = assembleCollectorSnapshots([
  loadFixture("pr-stale.json"),
  loadFixture("ci-red.json"),
  loadFixture("repo-quiet-saudavel.json"),
  loadFixture("repo-quiet-desconhecido.json"),
]);

const model = buildCompanyEngineeringReadModel(assembled, { now: NOW });

const blocked = model.blocked_repos.map((item) => item.full_name).sort();
const hypotheses = model.hypothesis_repos.map((item) => item.full_name).sort();
const reasons = model.attention.map((item) => `${item.repo}:${item.reason_code}:${item.claim_kind}`);

if (!blocked.includes("confenge/billing-api")) {
  fail("blocked repos must include confenge/billing-api (stale PR)");
}
if (!blocked.includes("confenge/web-cfg")) {
  fail("blocked repos must include confenge/web-cfg (CI red)");
}
if (blocked.includes("confenge/docs")) {
  fail("healthy-quiet confenge/docs must not be a fact-blocker");
}
if (blocked.includes("confenge/extra-cli")) {
  fail("unknown-quiet confenge/extra-cli must not be a fact-blocker");
}
if (!hypotheses.includes("confenge/extra-cli")) {
  fail("unknown-quiet confenge/extra-cli must appear as a hypothesis repo");
}

const stale = model.attention.find(
  (item) => item.reason_code === "stale_pr" && item.repo === "confenge/billing-api",
);
const ci = model.attention.find(
  (item) => item.reason_code === "ci_red" && item.repo === "confenge/web-cfg",
);
const unknown = model.attention.find(
  (item) => item.reason_code === "unknown_quiet" && item.repo === "confenge/extra-cli",
);
if (!stale || stale.claim_kind !== "fact") {
  fail("stale PR attention candidate missing or not fact-typed");
}
if (!ci || ci.claim_kind !== "fact") {
  fail("CI red attention candidate missing or not fact-typed");
}
if (!unknown || unknown.claim_kind !== "hypothesis") {
  fail("unknown quiet must be hypothesis-typed when present");
}
if (unknown.title !== "trabalho ativo sem evidência recente") {
  fail("unknown quiet hypothesis title is wrong");
}

const docs = model.repos.find((repo) => repo.repo.full_name === "confenge/docs");
if (!docs || docs.health !== "healthy") {
  fail("quiet saudável repo must be healthy");
}
if (docs.blockers.length !== 0) {
  fail("quiet saudável repo must not have blockers");
}

const canonical = serializeReadModel(model);
if (canonical.includes("DIFF_BODY_MUST_NOT_LEAK") || canonical.includes("ghp_")) {
  fail("serialized output leaked a diff body or token");
}

process.stdout.write("PASS engineering-consumer\n");
process.stdout.write(`blocked_repos=${blocked.join(",")}\n`);
process.stdout.write(`hypothesis_repos=${hypotheses.join(",")}\n`);
process.stdout.write(`reasons=${reasons.join("|")}\n`);
process.stdout.write(`headlines=${model.attention_headlines.join(" || ")}\n`);
process.stdout.write("CANONICAL_BEGIN\n");
process.stdout.write(`${canonical}\n`);
process.stdout.write("CANONICAL_END\n");
