import assert from "node:assert/strict";
import { test } from "node:test";
import { findKubernetesManifests, isKubernetesWorkload } from "../src/k8s.ts";
import { PACK_ROOT } from "../src/paths.ts";

test("deploy pack contains no Kubernetes workload manifests", () => {
  assert.equal(findKubernetesManifests(PACK_ROOT).length, 0);
  assert.equal(
    isKubernetesWorkload("apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: x\n"),
    true,
  );
  assert.equal(isKubernetesWorkload("name: confenge-control-center\nservices:\n  postgres: {}\n"), false);
});
