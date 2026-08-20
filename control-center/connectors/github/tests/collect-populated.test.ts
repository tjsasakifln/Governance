import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collect } from "../src/collect.js";
import { toSourceObservations } from "../src/adapter.js";
import { ENGINEERING_SNAPSHOT_SCHEMA, SOURCE_OBSERVATION_SCHEMA } from "../src/types.js";
import {
  assertProvenance,
  FIXED_NOW,
  loadConfig,
  observationIds,
  serialized,
  TEST_TOKEN,
} from "./helpers.js";

describe("populated collect", () => {
  it("emits EngineeringSnapshot + SourceObservation with provenance and collect fields", async () => {
    const { config } = loadConfig("populated");
    const result = await collect(config);
    const { snapshot, observations } = result;

    assert.equal(snapshot.schema, ENGINEERING_SNAPSHOT_SCHEMA);
    assertProvenance(snapshot);
    assert.equal(snapshot.collected_at, FIXED_NOW.toISOString());
    assert.deepEqual(snapshot.allowlist, ["tjsasakifln/Governance", "tjsasakifln/web-cfg"]);

    const gov = snapshot.repos.find((repo) => repo.repo?.full_name === "tjsasakifln/Governance");
    assert.ok(gov);
    assert.ok(gov.repo);
    assertProvenance(gov.repo);
    assert.equal(gov.repo.default_branch, "main");
    assert.equal(gov.repo.last_activity_at, "2026-08-19T12:30:00Z");
    assert.equal(gov.repo_collection.ok, true);

    assert.deepEqual(
      gov.recent_commits.map((commit) => commit.sha),
      ["abc123def4567890", "fedcba0987654321"],
    );
    assert.equal(
      gov.recent_commits[0]?.message,
      "fix(commercial): fail-close mapping identifiers",
    );
    for (const commit of gov.recent_commits) {
      assertProvenance(commit);
    }

    assert.equal(gov.issues_collection.ok, true);
    assert.deepEqual(
      gov.open_issues.map((issue) => issue.number),
      [8, 9],
    );
    assert.equal(
      gov.open_issues.some((issue) => issue.number === 12),
      false,
      "issues API pull_request entries must not be treated as issues",
    );
    const high = gov.open_issues.find((issue) => issue.number === 8);
    assert.equal(high?.priority, "high");
    assert.deepEqual(high?.labels, ["priority:high", "engineering"]);
    const p1 = gov.open_issues.find((issue) => issue.number === 9);
    assert.equal(p1?.priority, "p1");
    for (const issue of gov.open_issues) {
      assertProvenance(issue);
    }

    assert.equal(gov.open_pull_requests.length, 1);
    const pull = gov.open_pull_requests[0];
    assert.ok(pull);
    assert.equal(pull.draft, true);
    assert.equal(pull.created_at, "2026-08-18T18:00:00Z");
    assert.equal(pull.age_seconds, 172800);
    assert.equal(pull.review_status, "COMMENTED");
    assert.equal(pull.check_status, "failure");
    assertProvenance(pull);

    assert.equal(gov.check_failures.some((item) => item.name === "tests"), true);
    assert.equal(gov.check_failures.some((item) => item.name === "lint"), false);
    assert.equal(gov.workflow_failures.map((item) => item.remote_id).includes(555), true);
    assert.equal(gov.workflow_failures.some((item) => item.conclusion === "success"), false);

    const govDivergence = gov.divergence;
    assert.equal(govDivergence.support, "supported");
    if (govDivergence.support !== "supported") {
      assert.fail("expected supported compare");
    } else {
      assert.equal(govDivergence.ahead_by, 4);
      assert.equal(govDivergence.behind_by, 2);
      assert.equal(govDivergence.status, "diverged");
      assert.equal(govDivergence.base, "main");
      assert.equal(govDivergence.head, "cc/05-github-collector");
    }
    assertProvenance(govDivergence);

    const web = snapshot.repos.find((repo) => repo.repo?.full_name === "tjsasakifln/web-cfg");
    assert.ok(web);
    assert.equal(web.issues_collection.ok, true);
    assert.deepEqual(web.open_issues, []);
    const webDivergence = web.divergence;
    if (webDivergence.support === "supported") {
      assert.fail("expected unsupported compare when no relevant ref exists");
    } else {
      assert.equal(webDivergence.ahead_by, null);
      assert.equal(webDivergence.behind_by, null);
      assert.equal(webDivergence.reason, "no_relevant_compare_ref");
    }

    assert.ok(observations.length > 0);
    for (const observation of observations) {
      assert.equal(observation.schema, SOURCE_OBSERVATION_SCHEMA);
      assertProvenance(observation);
    }
    const adapterAgain = toSourceObservations(snapshot);
    assert.deepEqual(
      adapterAgain.map((item) => item.observation_id),
      observations.map((item) => item.observation_id),
    );

    const haystack = serialized(result);
    assert.equal(haystack.includes(TEST_TOKEN), false);
    assert.equal(haystack.includes("Bearer "), false);
  });

  it("compare 404 is unsupported, not zero divergence", async () => {
    const { config } = loadConfig("compare-404");
    const result = await collect(config);
    const gov = result.snapshot.repos[0];
    assert.ok(gov);
    const divergence = gov.divergence;
    if (divergence.support === "supported") {
      assert.fail("compare 404 must not invent ahead/behind zeros");
    } else {
      assert.equal(divergence.ahead_by, null);
      assert.equal(divergence.behind_by, null);
      assert.equal(divergence.status, "unsupported");
      assert.equal(divergence.reason, "compare_not_found");
    }
    assert.equal(divergence.freshness_status, "unsupported");
  });

  it("second collect of the same bodies is idempotent", async () => {
    const first = loadConfig("populated");
    const second = loadConfig("populated");
    const a = await collect(first.config);
    const b = await collect(second.config);
    assert.deepEqual(observationIds(a), observationIds(b));
    assert.equal(a.snapshot.snapshot_id, b.snapshot.snapshot_id);
    const govA = a.snapshot.repos[0]?.open_issues.map((issue) => issue.observation_id);
    const govB = b.snapshot.repos[0]?.open_issues.map((issue) => issue.observation_id);
    assert.deepEqual(govA, govB);
  });
});
