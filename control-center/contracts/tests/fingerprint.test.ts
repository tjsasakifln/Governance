import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contractFingerprint,
  fingerprintArtifacts,
  publicOntologyArtifacts,
} from "../src/index.js";

describe("CONTRACT_FINGERPRINT", () => {
  it("is deterministic across two shipped runs on the same tree", () => {
    const first = contractFingerprint();
    const second = contractFingerprint();
    assert.match(first, /^sha256:[0-9a-f]{64}$/);
    assert.equal(first, second);
    assert.equal(fingerprintArtifacts(publicOntologyArtifacts()), first);
  });

  it("changes when a public catalog byte changes", () => {
    const artifacts = publicOntologyArtifacts();
    const original = fingerprintArtifacts(artifacts);
    const mutated = artifacts.map((item) =>
      item.path === "catalog.json"
        ? { path: item.path, canonical: item.canonical.replace("Directive", "DirectiveX") }
        : item,
    );
    const after = fingerprintArtifacts(mutated);
    assert.notEqual(after, original);
    assert.equal(fingerprintArtifacts(artifacts), original);
  });

  it("changes when a public schema byte changes", () => {
    const artifacts = publicOntologyArtifacts();
    const original = fingerprintArtifacts(artifacts);
    const target = artifacts.find((item) => item.path.endsWith("finance-snapshot.v1.schema.json"));
    assert.ok(target, "finance snapshot schema is a public ontology input");
    const mutated = artifacts.map((item) =>
      item.path === target.path
        ? { path: item.path, canonical: `${item.canonical} ` }
        : item,
    );
    assert.notEqual(fingerprintArtifacts(mutated), original);
  });

  it("changes when a taxonomy byte changes", () => {
    const artifacts = publicOntologyArtifacts();
    const original = fingerprintArtifacts(artifacts);
    const mutated = artifacts.map((item) =>
      item.path === "src/taxonomy.ts"
        ? { path: item.path, canonical: item.canonical.replace("FRESH", "FRESHX") }
        : item,
    );
    assert.notEqual(fingerprintArtifacts(mutated), original);
  });
});
