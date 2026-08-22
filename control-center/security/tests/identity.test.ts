import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_TRUSTED_HOPS,
  actorRefFromIdentity,
  defaultTrustedHopPolicy,
  parseForwardAuthIdentity,
  type IdentityRequest,
} from "../src/index.js";

const policy = defaultTrustedHopPolicy(DEFAULT_TRUSTED_HOPS);

const trustedHeaders = {
  "Remote-User": "operator",
  "Remote-Groups": "admins,operators",
  "Remote-Name": "Control Center Operator",
  "Remote-Email": "ops@example.invalid",
};

function request(
  remoteAddress: string,
  headers: IdentityRequest["headers"] = trustedHeaders,
): IdentityRequest {
  return { remoteAddress, headers };
}

describe("parseForwardAuthIdentity", () => {
  it("accepts Authelia headers from a trusted hop", () => {
    const result = parseForwardAuthIdentity(request("10.89.0.2"), policy);
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.identity.user, "operator");
    assert.deepEqual(result.identity.groups, ["admins", "operators"]);
    assert.equal(result.identity.name, "Control Center Operator");
    assert.equal(result.identity.email, "ops@example.invalid");
    const actor = actorRefFromIdentity(result.identity);
    assert.equal(actor.kind, "human");
    assert.equal(actor.id, "operator");
    assert.equal(actor.display_name, "Control Center Operator");
  });

  it("is case-insensitive on header names and trusts IPv4-mapped IPv6 hops", () => {
    const result = parseForwardAuthIdentity(
      request("::ffff:10.89.0.2", {
        "remote-user": "operator",
        "REMOTE-GROUPS": "operators",
        "Remote-Name": "Op",
        "Remote-Email": "ops@example.invalid",
      }),
      policy,
    );
    assert.equal(result.ok, true);
  });

  it("denies missing identity from a trusted hop", () => {
    const result = parseForwardAuthIdentity(request("10.89.0.2", {}), policy);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.code, "missing_identity");
  });

  it("denies empty identity fields from a trusted hop", () => {
    const result = parseForwardAuthIdentity(
      request("127.0.0.1", {
        "Remote-User": "   ",
        "Remote-Groups": "operators",
        "Remote-Name": "Op",
        "Remote-Email": "ops@example.invalid",
      }),
      policy,
    );
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.code, "empty_identity");
  });

  it("denies spoofed headers from an untrusted hop", () => {
    const result = parseForwardAuthIdentity(request("8.8.8.8"), policy);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.code, "spoofed_identity");
  });

  it("denies an untrusted hop without headers", () => {
    const result = parseForwardAuthIdentity(request("8.8.8.8", {}), policy);
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.code, "untrusted_hop");
  });

  it("does not trust X-Forwarded-For as a hop", () => {
    const result = parseForwardAuthIdentity(
      {
        remoteAddress: "203.0.113.9",
        headers: {
          ...trustedHeaders,
          "X-Forwarded-For": "10.89.0.2",
          "X-Real-IP": "10.89.0.2",
        },
      },
      policy,
    );
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.code, "spoofed_identity");
  });

  it("denies malformed email and missing operator group", () => {
    const badEmail = parseForwardAuthIdentity(
      request("10.89.0.2", { ...trustedHeaders, "Remote-Email": "not-an-email" }),
      policy,
    );
    assert.equal(badEmail.ok, false);
    if (!badEmail.ok) {
      assert.equal(badEmail.code, "malformed_identity");
    }
    const badGroup = parseForwardAuthIdentity(
      request("10.89.0.2", { ...trustedHeaders, "Remote-Groups": "viewers" }),
      policy,
    );
    assert.equal(badGroup.ok, false);
    if (!badGroup.ok) {
      assert.equal(badGroup.code, "malformed_identity");
    }
  });

  it("denies a duplicated identity header instead of trusting the first copy", () => {
    // A mount that hands headers through as arrays (Node's own http server
    // joins them into one string) must not let a client-supplied copy win over
    // the value the proxy appends.
    const duplicated = parseForwardAuthIdentity(
      request("10.89.0.2", {
        ...trustedHeaders,
        "Remote-User": ["evil", "operator"],
      }),
      policy,
    );
    assert.equal(duplicated.ok, false);
    if (!duplicated.ok) {
      assert.equal(duplicated.code, "missing_identity");
    }

    const duplicatedGroups = parseForwardAuthIdentity(
      request("10.89.0.2", {
        ...trustedHeaders,
        "Remote-Groups": ["operators", "operators"],
      }),
      policy,
    );
    assert.equal(duplicatedGroups.ok, false);

    // A single-valued array is still a single value.
    const single = parseForwardAuthIdentity(
      request("10.89.0.2", {
        "Remote-User": ["operator"],
        "Remote-Groups": ["operators"],
        "Remote-Name": ["Control Center Operator"],
        "Remote-Email": ["ops@example.invalid"],
      }),
      policy,
    );
    assert.equal(single.ok, true);
    if (single.ok) {
      assert.equal(single.identity.user, "operator");
    }
  });

  it("fail-closes when no trusted hops are configured", () => {
    const result = parseForwardAuthIdentity(request("10.89.0.2"), {
      trustedHops: [],
      requiredGroups: ["operators"],
    });
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.code, "spoofed_identity");
  });
});
