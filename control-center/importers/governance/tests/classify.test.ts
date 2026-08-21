import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyFile } from "../src/classify.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("classifyFile conservative rules", () => {
  it("emits decision only from an explicit Decision heading", () => {
    const result = classifyFile(
      "decisions/ADR-X.md",
      encode("# Title\n\n## Decision\n\nDo the thing.\n"),
    );
    assert.equal(result.classifiable, true);
    if (!result.classifiable) {
      return;
    }
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0]?.kind, "decision");
  });

  it("does not treat a JSON filename containing decision as a kind", () => {
    const result = classifyFile(
      "commercial/we-made-a-decision-notes.json",
      encode(JSON.stringify({ title: "notes", notes: "we decided maybe" })),
    );
    assert.equal(result.classifiable, true);
    if (!result.classifiable) {
      return;
    }
    assert.equal(result.records[0]?.kind, "hypothesis");
  });

  it("classifies JSON with kind=constraint as constraint", () => {
    const result = classifyFile(
      "commercial/authority/no-checkout.json",
      encode(
        JSON.stringify({
          kind: "constraint",
          title: "No production checkout",
          body: "production_checkout_enabled remains false in Git.",
          status: "active",
          scope: "commercial",
        }),
      ),
    );
    assert.equal(result.classifiable, true);
    if (!result.classifiable) {
      return;
    }
    assert.equal(result.records[0]?.kind, "constraint");
  });

  it("projects schema_version JSON without kind as fact, not decision", () => {
    const result = classifyFile(
      "commercial/authority/authority-manifest.v1.json",
      encode(
        JSON.stringify({
          schema_version: "authority-manifest.v1",
          catalog_authority: "APPROVED",
          production_checkout_enabled: false,
        }),
      ),
    );
    assert.equal(result.classifiable, true);
    if (!result.classifiable) {
      return;
    }
    assert.equal(result.records[0]?.kind, "fact");
  });

  it("does not promote a decisions array without per-item kind to decision", () => {
    const result = classifyFile(
      "commercial/legal/DECISION_CLASSIFICATION.json",
      encode(
        JSON.stringify({
          schema_version: "synthetic-classification.v1",
          decisions: [{ id: "foro", status: "PENDING", owner: "founder" }],
        }),
      ),
    );
    assert.equal(result.classifiable, true);
    if (!result.classifiable) {
      return;
    }
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0]?.kind, "fact");
    assert.notEqual(result.records[0]?.kind, "decision");
  });

  it("reports binary as unclassifiable", () => {
    const result = classifyFile(
      "commercial/blobs/unclassifiable.bin",
      new Uint8Array([0, 1, 2, 255, 0, 10]),
    );
    assert.equal(result.classifiable, false);
    if (result.classifiable) {
      return;
    }
    assert.equal(result.reason, "binary_or_non_text");
  });

  it("keeps nested catalog fields when projecting JSON without a body field", () => {
    const source = JSON.stringify({
      schema_version: "synthetic-nested-manifest.v1",
      catalog_authority: "APPROVED",
      consumers: [{ id: "synthetic-consumer#1", role: "test_pin" }],
      artifacts: [
        {
          path: "commercial/offers/synthetic-catalog.v1.json",
          content_hash:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
      offers: [{ offer_id: "CFG-SYNTH-NESTED-v1", amount_cents: 12345, currency: "BRL" }],
    });
    const result = classifyFile("commercial/authority/nested.json", encode(source));
    assert.equal(result.classifiable, true);
    if (!result.classifiable) {
      return;
    }
    const body = result.records[0]?.body ?? "";
    assert.equal(result.records[0]?.kind, "fact");
    assert.match(body, /CFG-SYNTH-NESTED-v1/);
    assert.match(body, /amount_cents/);
    assert.match(body, /12345/);
    assert.match(body, /synthetic-consumer#1/);
    assert.match(body, /commercial\/offers\/synthetic-catalog.v1.json/);
    assert.match(body, /content_hash/);
    assert.doesNotMatch(body, /"offers"\s*:\s*\[\s*\{\s*\}\s*\]/);
  });

  it("does not strip nested keys on a labeled child record without body", () => {
    const source = JSON.stringify({
      records: [
        {
          kind: "fact",
          title: "synthetic nested child",
          offers: [{ offer_id: "CFG-SYNTH-CHILD-v1", amount_cents: 999 }],
        },
      ],
    });
    const result = classifyFile("commercial/authority/nested-child.json", encode(source));
    assert.equal(result.classifiable, true);
    if (!result.classifiable) {
      return;
    }
    const body = result.records[0]?.body ?? "";
    assert.match(body, /CFG-SYNTH-CHILD-v1/);
    assert.match(body, /amount_cents/);
    assert.match(body, /999/);
  });
});
