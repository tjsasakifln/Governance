import assert from "node:assert/strict";
import { test } from "node:test";
import { createHttpAdapter, createMockAdapter } from "../../apps/web-shell/src/adapters/index.ts";

test("production web adapter is HTTP not mock", () => {
  const mock = createMockAdapter();
  const http = createHttpAdapter("http://127.0.0.1:8787");
  assert.equal(mock.mode, "mock");
  assert.equal(http.mode, "http");
  assert.notEqual(http.mode, "mock");
});
