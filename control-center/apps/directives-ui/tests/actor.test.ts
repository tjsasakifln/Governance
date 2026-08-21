import assert from "node:assert/strict";
import { test } from "node:test";
import { founderApproval, resolveIdentity } from "../src/actor.ts";
import { FORBIDDEN_MUTATIONS } from "../src/types.ts";
import { makeSession } from "./helpers.ts";

test("mock identity is an opaque handle, not a password", () => {
  const identity = resolveIdentity({});
  assert.equal(identity.actor.id, "human:founder");
  assert.equal(identity.role, "founder");
  assert.doesNotMatch(identity.actor.id, /password|secret|token/i);
  const approval = founderApproval(identity);
  assert.equal(approval.canMutate, true);
  assert.equal(approval.code, "founder_ok");
});

test("CC_USE_MOCK_IDENTITY=0 without env is fail-closed", () => {
  const identity = resolveIdentity({ CC_USE_MOCK_IDENTITY: "0" });
  const approval = founderApproval(identity);
  assert.equal(approval.canMutate, false);
  assert.equal(approval.code, "identity_unconfigured");
});

test("mock service refuses forbidden provider mutations", () => {
  const session = makeSession();
  for (const action of FORBIDDEN_MUTATIONS) {
    assert.equal(session.service.refusesForbiddenMutation(action), true);
  }
  assert.equal(session.service.refusesForbiddenMutation("create"), false);
});
