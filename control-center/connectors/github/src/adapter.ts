import {
  ENGINEERING_SNAPSHOT_SCHEMA,
  SOURCE_OBSERVATION_SCHEMA,
  type CollectResult,
  type EngineeringSnapshot,
  type SourceObservation,
} from "./types.js";

export function toSourceObservations(snapshot: EngineeringSnapshot): SourceObservation[] {
  const observations: SourceObservation[] = [];

  observations.push({
    schema: SOURCE_OBSERVATION_SCHEMA,
    observation_id: snapshot.snapshot_id,
    kind: "engineering_snapshot",
    subject: snapshot.allowlist.join(","),
    source: snapshot.source,
    observed_at: snapshot.observed_at,
    freshness_status: snapshot.freshness_status,
    ...(snapshot.confidence !== undefined ? { confidence: snapshot.confidence } : {}),
    payload: {
      schema: ENGINEERING_SNAPSHOT_SCHEMA,
      allowlist: snapshot.allowlist,
      repo_count: snapshot.repos.length,
      error_count: snapshot.errors.length,
    },
  });

  for (const error of snapshot.errors) {
    observations.push(observationFrom("collection_error", error.repo ?? "_", error));
  }

  for (const repoSnap of snapshot.repos) {
    if (repoSnap.repo) {
      observations.push(observationFrom("repo", repoSnap.repo.full_name, repoSnap.repo));
    }
    for (const commit of repoSnap.recent_commits) {
      observations.push(observationFrom("commit", commit.repo, commit));
    }
    for (const issue of repoSnap.open_issues) {
      observations.push(observationFrom("issue", issue.repo, issue));
    }
    for (const pull of repoSnap.open_pull_requests) {
      observations.push(observationFrom("pull_request", pull.repo, pull));
    }
    for (const check of repoSnap.check_failures) {
      observations.push(observationFrom("check_failure", check.repo, check));
    }
    for (const workflow of repoSnap.workflow_failures) {
      observations.push(observationFrom("workflow_failure", workflow.repo, workflow));
    }
    observations.push(
      observationFrom("branch_divergence", repoSnap.divergence.repo, repoSnap.divergence),
    );
    for (const error of repoSnap.errors) {
      observations.push(observationFrom("collection_error", error.repo ?? "_", error));
    }
  }

  return observations;
}

export function attachObservations(snapshot: EngineeringSnapshot): CollectResult {
  return {
    snapshot,
    observations: toSourceObservations(snapshot),
  };
}

function observationFrom(
  kind: SourceObservation["kind"],
  subject: string,
  item: {
    observation_id: string;
    source: SourceObservation["source"];
    observed_at: string;
    freshness_status: SourceObservation["freshness_status"];
    confidence?: number;
  },
): SourceObservation {
  const { observation_id, source, observed_at, freshness_status, confidence, ...payload } =
    item;
  const observation: SourceObservation = {
    schema: SOURCE_OBSERVATION_SCHEMA,
    observation_id,
    kind,
    subject,
    source,
    observed_at,
    freshness_status,
    payload: payload as Record<string, unknown>,
  };
  if (confidence !== undefined) {
    observation.confidence = confidence;
  }
  return observation;
}
