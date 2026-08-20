import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyState,
  errorState,
  loadingState,
  readyState,
  resolveViewState,
  staleState,
  viewStateKind,
} from "../src/view-state";

test("loading, error, stale and empty helpers produce distinct explicit states", () => {
  const loading = loadingState();
  const error = errorState("boom", "X");
  const empty = emptyState("nada");
  const stale = staleState({ n: 1 }, "defasado");
  const ready = readyState({ n: 1 });
  const kinds = [loading, error, empty, stale, ready].map(viewStateKind);
  assert.deepEqual(kinds, ["loading", "error", "empty", "stale", "ready"]);
  assert.notEqual(loading.kind, error.kind);
  assert.notEqual(error.kind, stale.kind);
  assert.notEqual(stale.kind, empty.kind);
  assert.notEqual(empty.kind, ready.kind);
  assert.equal(error.message, "boom");
  assert.equal(error.code, "X");
  assert.equal(empty.message, "nada");
  assert.equal(stale.data.n, 1);
});

test("resolveViewState override independently exercises each view kind", () => {
  const base = {
    data: { items: [1] },
    isEmpty: (data: { items: number[] }) => data.items.length === 0,
    isStale: () => false,
  };
  assert.equal(resolveViewState({ ...base, override: "loading" }).kind, "loading");
  assert.equal(resolveViewState({ ...base, override: "error" }).kind, "error");
  assert.equal(resolveViewState({ ...base, override: "empty" }).kind, "empty");
  assert.equal(resolveViewState({ ...base, override: "stale" }).kind, "stale");
  assert.equal(resolveViewState({ ...base, override: "ready" }).kind, "ready");
  assert.equal(
    resolveViewState({
      data: { items: [] },
      isEmpty: (data) => data.items.length === 0,
      isStale: () => false,
    }).kind,
    "empty",
  );
  assert.equal(
    resolveViewState({
      data: { items: [1] },
      isEmpty: () => false,
      isStale: () => true,
    }).kind,
    "stale",
  );
  assert.equal(
    resolveViewState({
      loading: true,
      data: null,
      isEmpty: () => true,
      isStale: () => false,
    }).kind,
    "loading",
  );
  assert.equal(
    resolveViewState({
      error: { message: "falha", code: "E" },
      data: null,
      isEmpty: () => true,
      isStale: () => false,
    }).kind,
    "error",
  );
});
