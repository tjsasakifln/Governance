import assert from "node:assert/strict";
import { test } from "node:test";
import { combinedTone, freshnessTone, isGreenTone } from "../src/freshness.js";

test("only exact FRESH may be green; STALE UNKNOWN ERROR and unknown values never are", () => {
  assert.equal(freshnessTone("FRESH"), "green");
  assert.equal(isGreenTone(freshnessTone("FRESH")), true);
  assert.equal(freshnessTone("STALE"), "amber");
  assert.equal(freshnessTone("UNKNOWN"), "slate");
  assert.equal(freshnessTone("ERROR"), "red");
  assert.equal(freshnessTone("expired"), "slate");
  assert.equal(freshnessTone(""), "slate");
  assert.equal(freshnessTone("fresh"), "slate");
  assert.equal(isGreenTone(freshnessTone("STALE")), false);
  assert.equal(isGreenTone(freshnessTone("UNKNOWN")), false);
  assert.equal(isGreenTone(freshnessTone("ERROR")), false);
  assert.equal(isGreenTone(freshnessTone("nope")), false);
});

test("health unknown/degraded/down never render green even if freshness is FRESH", () => {
  assert.equal(combinedTone("FRESH", "healthy"), "green");
  assert.equal(combinedTone("FRESH", "degraded"), "amber");
  assert.equal(combinedTone("FRESH", "down"), "red");
  assert.equal(combinedTone("FRESH", "unknown"), "slate");
  assert.equal(combinedTone("STALE", "healthy"), "amber");
});
