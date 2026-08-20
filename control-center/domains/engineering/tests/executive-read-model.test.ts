import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assembleCollectorSnapshots,
  buildCompanyEngineeringReadModel,
  HYPOTHESIS_ACTIVE_WORK_WITHOUT_EVIDENCE,
  ingestCollectorSnapshot,
  InMemoryEngineeringStore,
  parseCollectorSnapshot,
  readByScope,
  serializeReadModel,
} from "../src/index.js";
import type { CompanyEngineeringReadModel, RepoExecutiveView } from "../src/types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date("2026-08-20T12:00:00.000Z");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(root, "fixtures", name), "utf8"));
}

function modelFrom(name: string): CompanyEngineeringReadModel {
  return buildCompanyEngineeringReadModel(loadFixture(name), { now: NOW });
}

function onlyRepo(model: CompanyEngineeringReadModel): RepoExecutiveView {
  assert.equal(model.repos.length, 1);
  const repo = model.repos[0];
  assert.ok(repo);
  return repo;
}

function hasProvenance(item: {
  provenance?: {
    source?: { system?: string; kind?: string; locator?: string };
    observed_at?: string;
    freshness_status?: string;
    confidence?: number;
  };
}): void {
  const provenance = item.provenance;
  assert.ok(provenance, "aggregated item is missing provenance");
  assert.equal(typeof provenance.source?.system, "string");
  assert.ok(provenance.source?.system);
  assert.equal(typeof provenance.source.kind, "string");
  assert.equal(typeof provenance.source.locator, "string");
  assert.match(provenance.observed_at ?? "", /Z$/);
  assert.match(provenance.freshness_status ?? "", /^(FRESH|STALE|UNKNOWN|ERROR)$/);
  assert.equal(typeof provenance.confidence, "number");
  const confidence = provenance.confidence ?? -1;
  assert.ok(confidence >= 0 && confidence <= 1);
}

function assertNoSecretsOrDiffs(serialized: string): void {
  assert.equal(serialized.includes("DIFF_BODY_MUST_NOT_LEAK"), false);
  assert.equal(serialized.includes("ghp_"), false);
  assert.equal(serialized.includes("THIS_MUST_NOT_LEAK"), false);
  assert.equal(/"(token|pat|password|secret|authorization)"\s*:/i.test(serialized), false);
}

describe("PR stale fixture", () => {
  it("surfaces an explainable stale PR attention candidate with provenance and a link, never a diff", () => {
    const model = modelFrom("pr-stale.json");
    const repo = onlyRepo(model);
    assert.equal(repo.repo.full_name, "confenge/billing-api");
    assert.ok(repo.open_prs.length >= 1);
    const stale = repo.open_prs.find((pr) => pr.number === 42);
    assert.ok(stale);
    assert.equal(stale.stale, true);
    assert.ok(stale.age_seconds >= 7 * 24 * 60 * 60);
    assert.equal(repo.aging.stale_pr_count, 1);
    assert.ok(repo.aging.oldest_open_pr_age_seconds !== null);
    hasProvenance(stale);
    assert.match(stale.html_url, /^https:\/\/github\.com\/confenge\/billing-api\/pull\/42$/);

    const candidate = model.attention.find(
      (item) => item.reason_code === "stale_pr" && item.repo === "confenge/billing-api",
    );
    assert.ok(candidate);
    assert.equal(candidate.claim_kind, "fact");
    assert.match(candidate.summary, /stale/i);
    assert.equal(candidate.reference.html_url, stale.html_url);
    hasProvenance(candidate);
    assert.ok(model.blocked_repos.some((item) => item.full_name === "confenge/billing-api"));

    const serialized = serializeReadModel(model);
    assertNoSecretsOrDiffs(serialized);
    assert.equal(serialized.includes("@@ -1,200"), false);
  });
});

describe("CI red fixture", () => {
  it("marks health not healthy and lists broken checks as blockers and attention", () => {
    const model = modelFrom("ci-red.json");
    const repo = onlyRepo(model);
    assert.equal(repo.repo.full_name, "confenge/web-cfg");
    assert.notEqual(repo.health, "healthy");
    assert.ok(repo.broken_checks.length >= 1);
    const ci = repo.broken_checks.find((check) => check.name.toLowerCase() === "ci");
    assert.ok(ci);
    assert.match(ci.html_url, /^https:\/\/github\.com\//);
    hasProvenance(ci);

    const blocker = repo.blockers.find((item) => item.kind === "ci_red");
    assert.ok(blocker);
    assert.equal(blocker.claim_kind, "fact");
    assert.match(blocker.reference.html_url, /^https:\/\/github\.com\//);

    const candidate = model.attention.find(
      (item) => item.reason_code === "ci_red" && item.repo === "confenge/web-cfg",
    );
    assert.ok(candidate);
    assert.match(candidate.summary, /check|CI|ci/i);
    assert.ok(
      model.attention_headlines.some(
        (line) => line.includes("confenge/web-cfg") && /CI|ci/.test(line),
      ),
    );
    hasProvenance(candidate);
    assertNoSecretsOrDiffs(serializeReadModel(model));
  });
});

describe("repo quiet saudável fixture", () => {
  it("is not blocked and is not a fact 'trabalho ativo sem evidência recente'", () => {
    const model = modelFrom("repo-quiet-saudavel.json");
    const repo = onlyRepo(model);
    assert.equal(repo.repo.full_name, "confenge/docs");
    assert.equal(repo.health, "healthy");
    assert.equal(repo.blockers.length, 0);
    assert.ok(repo.last_activity);
    assert.equal(typeof repo.last_activity.at, "string");
    assert.equal(repo.p0_p1_issues.length, 0);
    assert.equal(repo.broken_checks.length, 0);
    assert.equal(repo.aging.stale_pr_count, 0);
    assert.equal(model.blocked_repos.length, 0);
    assert.equal(model.hypothesis_repos.length, 0);
    assert.equal(
      repo.claims.some((claim) => claim.kind === "fact" && claim.title === HYPOTHESIS_ACTIVE_WORK_WITHOUT_EVIDENCE),
      false,
    );
    assert.equal(
      model.attention.some(
        (item) =>
          item.claim_kind === "fact" && item.title.includes(HYPOTHESIS_ACTIVE_WORK_WITHOUT_EVIDENCE),
      ),
      false,
    );
    assert.equal(
      JSON.stringify(model).includes(HYPOTHESIS_ACTIVE_WORK_WITHOUT_EVIDENCE),
      false,
    );
    hasProvenance(repo);
    assert.match(repo.provenance.freshness_status, /^(FRESH|STALE)$/);
  });
});

describe("repo quiet desconhecido fixture", () => {
  it("emits trabalho ativo sem evidência recente only as hypothesis and stays distinguishable", () => {
    const model = modelFrom("repo-quiet-desconhecido.json");
    const repo = onlyRepo(model);
    assert.equal(repo.repo.full_name, "confenge/extra-cli");
    assert.equal(repo.health, "unknown");
    assert.match(repo.provenance.freshness_status, /^(UNKNOWN|ERROR)$/);
    const hypothesis = repo.claims.find((claim) => claim.code === "active_work_without_recent_evidence");
    assert.ok(hypothesis);
    assert.equal(hypothesis.kind, "hypothesis");
    assert.notEqual(hypothesis.kind, "fact");
    assert.equal(hypothesis.title, HYPOTHESIS_ACTIVE_WORK_WITHOUT_EVIDENCE);
    const blocker = repo.blockers.find((item) => item.kind === "unknown_quiet");
    assert.ok(blocker);
    assert.equal(blocker.claim_kind, "hypothesis");
    const candidate = model.attention.find((item) => item.reason_code === "unknown_quiet");
    assert.ok(candidate);
    assert.equal(candidate.claim_kind, "hypothesis");
    assert.notEqual(candidate.claim_kind, "fact");
    assert.equal(
      model.blocked_repos.some((item) => item.full_name === "confenge/extra-cli"),
      false,
    );
    assert.ok(model.hypothesis_repos.some((item) => item.full_name === "confenge/extra-cli"));
    hasProvenance(repo);
    hasProvenance(candidate);
  });
});

describe("company-wide aggregation and scoped reads", () => {
  it("lists fact-blocked repos, keeps unknown as hypothesis, omits healthy-quiet, and scopes per repo", () => {
    const assembled = assembleCollectorSnapshots([
      loadFixture("pr-stale.json"),
      loadFixture("ci-red.json"),
      loadFixture("repo-quiet-saudavel.json"),
      loadFixture("repo-quiet-desconhecido.json"),
    ]);
    const model = ingestCollectorSnapshot(assembled, { now: NOW });
    const names = model.repos.map((repo) => repo.repo.full_name).sort();
    assert.deepEqual(names, [
      "confenge/billing-api",
      "confenge/docs",
      "confenge/extra-cli",
      "confenge/web-cfg",
    ]);

    const blocked = model.blocked_repos.map((item) => item.full_name).sort();
    assert.deepEqual(blocked, ["confenge/billing-api", "confenge/web-cfg"]);
    assert.equal(blocked.includes("confenge/docs"), false);
    assert.equal(blocked.includes("confenge/extra-cli"), false);

    assert.ok(model.hypothesis_repos.some((item) => item.full_name === "confenge/extra-cli"));
    assert.equal(
      model.hypothesis_repos.every((item) => item.claim_kind === "hypothesis"),
      true,
    );
    assert.equal(
      model.blocked_repos.every((item) => item.claim_kind === "fact"),
      true,
    );

    const headlines = model.attention_headlines.join("\n");
    assert.match(headlines, /billing-api/);
    assert.match(headlines, /web-cfg/);
    assert.match(headlines, /stale/i);
    assert.match(headlines, /CI|ci/);
    assert.match(headlines, /extra-cli/);
    assert.match(headlines, /hypothesis/);
    assert.equal(headlines.includes("confenge/docs"), false);

    const parsed = parseCollectorSnapshot(assembled);
    assert.equal(parsed.repos.length, 4);

    const store = new InMemoryEngineeringStore();
    store.ingest(assembled, { now: NOW });
    const scoped = store.getRepo("repo:confenge/docs");
    assert.ok(scoped);
    assert.equal(scoped.repo.full_name, "confenge/docs");
    const scopedJson = serializeReadModel(scoped);
    assert.equal(scopedJson.includes("confenge/billing-api"), false);
    assert.equal(scopedJson.includes("confenge/web-cfg"), false);
    assert.equal(scopedJson.includes("confenge/extra-cli"), false);

    const companyRead = readByScope(model, "company");
    assert.equal(companyRead.kind, "company");
    const missing = readByScope(model, "repo:does-not-exist");
    assert.equal(missing.kind, "empty");

    const attentionForDocs = store.listAttention("repo:confenge/docs");
    assert.equal(attentionForDocs.length, 0);
    const companyAttention = store.listAttention("company");
    assert.ok(companyAttention.length >= 2);
    assert.ok(companyAttention.every((item) => item.repo !== "confenge/docs" || item.claim_kind === "hypothesis"));

    for (const repo of model.repos) {
      hasProvenance(repo);
      for (const pr of repo.open_prs) hasProvenance(pr);
      for (const check of repo.broken_checks) hasProvenance(check);
      for (const issue of repo.p0_p1_issues) hasProvenance(issue);
      for (const blocker of repo.blockers) hasProvenance(blocker);
    }
    for (const item of model.attention) {
      hasProvenance(item);
      assert.ok(item.reference.html_url.startsWith("https://"));
    }

    const serialized = serializeReadModel(model);
    assertNoSecretsOrDiffs(serialized);
    assert.equal(serialized.includes("DIFF_BODY_MUST_NOT_LEAK"), false);
  });
});

describe("P0/P1 issues", () => {
  it("classifies collector priority labels as P0/P1 fact blockers", () => {
    const base = loadFixture("repo-quiet-saudavel.json") as {
      repos: Array<{
        open_issues: Array<Record<string, unknown>>;
      }>;
    };
    const repo = base.repos[0];
    assert.ok(repo);
    repo.open_issues.push({
      source: "github",
      observed_at: "2026-08-20T12:00:00.000Z",
      freshness_status: "fresh",
      confidence: 1,
      observation_id: "github:issue:confenge%2Fdocs:99",
      repo: "confenge/docs",
      number: 99,
      title: "Payment webhook silently dropped",
      state: "open",
      labels: ["P0"],
      priority: "p0",
      html_url: "https://github.com/confenge/docs/issues/99",
      created_at: "2026-08-20T01:00:00.000Z",
      updated_at: "2026-08-20T01:00:00.000Z",
    });
    const model = buildCompanyEngineeringReadModel(base, { now: NOW });
    const view = onlyRepo(model);
    assert.equal(view.health, "degraded");
    assert.equal(view.p0_p1_issues[0]?.priority, "P0");
    assert.ok(view.blockers.some((item) => item.kind === "p0_issue" && item.claim_kind === "fact"));
    assert.ok(model.attention.some((item) => item.reason_code === "p0_issue"));
  });
});
