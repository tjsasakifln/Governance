import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AsaasMutationForbiddenError,
  AsaasPathNotAllowlistedError,
  DefaultFetchTransport,
  GetOnlyAsaasClient,
  MUTATION_METHODS,
  RecordingTransport,
  assertGetAllowed,
  createFixtureTransport,
  parseAsaasConfig,
} from "../src/index.js";
import type { HttpRequest, HttpResponse, HttpTransport } from "../src/index.js";

const config = parseAsaasConfig({
  ASAAS_ENVIRONMENT: "sandbox",
  ASAAS_API_KEY: "fixture-local-key-do-not-send",
});

class BoomTransport implements HttpTransport {
  calls = 0;
  async request(_req: HttpRequest): Promise<HttpResponse> {
    this.calls += 1;
    throw new Error("transport must not be reached for mutations");
  }
}

describe("GET-only Asaas HTTP client", () => {
  it("rejects POST PUT PATCH DELETE before any transport call", async () => {
    const boom = new BoomTransport();
    const client = new GetOnlyAsaasClient(config, boom);
    for (const method of MUTATION_METHODS) {
      await assert.rejects(
        () => client.request(method, "/v3/payments"),
        AsaasMutationForbiddenError,
      );
    }
    assert.throws(() => client.post("/v3/payments"), AsaasMutationForbiddenError);
    assert.throws(() => client.put("/v3/payments/pay_x"), AsaasMutationForbiddenError);
    assert.throws(() => client.patch("/v3/payments/pay_x"), AsaasMutationForbiddenError);
    assert.throws(() => client.delete("/v3/payments/pay_x"), AsaasMutationForbiddenError);
    assert.equal(boom.calls, 0);
  });

  it("rejects known mutation paths even as GET", () => {
    const mutationPaths = [
      "/v3/payments",
      "/v3/payments/pay_fixtureConfirmed01/refund",
      "/v3/payments/pay_fixtureConfirmed01/payWithCreditCard",
      "/v3/payments/pay_x/receiveInCash",
      "/v3/webhook",
      "/v3/webhooks",
      "/v3/checkouts",
    ];
    assert.throws(
      () => assertGetAllowed("POST", "/v3/payments"),
      AsaasMutationForbiddenError,
    );
    for (const path of mutationPaths.slice(1)) {
      assert.throws(
        () => assertGetAllowed("GET", path),
        (err: unknown) =>
          err instanceof AsaasMutationForbiddenError ||
          err instanceof AsaasPathNotAllowlistedError,
      );
    }
  });

  it("rejects GET body", async () => {
    const boom = new BoomTransport();
    const client = new GetOnlyAsaasClient(config, boom);
    await assert.rejects(
      () => client.request("GET", "/v3/payments", { body: "{}" }),
      AsaasMutationForbiddenError,
    );
    assert.equal(boom.calls, 0);
  });

  it("issues only GET with empty body on recording collect paths", async () => {
    const recording = new RecordingTransport(createFixtureTransport());
    const client = new GetOnlyAsaasClient(config, recording);
    await client.getJson("/v3/customers", { limit: 100, offset: 0 });
    await client.getJson("/v3/payments", { limit: 100, offset: 0 });
    await client.getJson("/v3/subscriptions", { limit: 100, offset: 0 });
    await client.getJson("/v3/pix/transactions", { limit: 100, offset: 0 });
    await client.getJson("/v3/finance/balance");
    await client.getJson("/v3/financialTransactions", { limit: 100, offset: 0 });
    assert.ok(recording.log.length >= 6);
    for (const entry of recording.log) {
      assert.equal(entry.method, "GET");
      assert.equal(entry.body, null);
      const u = new URL(entry.url);
      assert.equal(u.protocol, "https:");
      assert.equal(u.hostname, "api-sandbox.asaas.com");
      assert.doesNotMatch(entry.url, /access_token|api_key|\$aact_/i);
      assertGetAllowed("GET", u.pathname);
    }
  });

  it("DefaultFetchTransport refuses mutations without calling fetch", async () => {
    let fetchCalls = 0;
    const transport = new DefaultFetchTransport(async () => {
      fetchCalls += 1;
      throw new Error("network must not run");
    });
    await assert.rejects(
      () =>
        transport.request({
          method: "POST",
          url: "https://api-sandbox.asaas.com/v3/payments",
          headers: {},
          body: "{}",
        }),
      AsaasMutationForbiddenError,
    );
    assert.equal(fetchCalls, 0);
  });

  it("refuses to follow redirects so access_token is not replayed", async () => {
    let redirect: RequestRedirect | undefined;
    const transport = new DefaultFetchTransport(async (_url, init) => {
      redirect = init?.redirect;
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await transport.request({
      method: "GET",
      url: "https://api-sandbox.asaas.com/v3/finance/balance",
      headers: { access_token: "fixture-local-key-do-not-send" },
    });
    assert.equal(redirect, "error");
  });
});
