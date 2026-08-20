import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AsaasConfigError,
  PRODUCTION_BASE_URL,
  SANDBOX_BASE_URL,
  parseAsaasConfig,
} from "../src/index.js";

describe("parseAsaasConfig fail-closed", () => {
  it("rejects missing environment", () => {
    assert.throws(
      () => parseAsaasConfig({ ASAAS_API_KEY: "k" }),
      AsaasConfigError,
    );
  });

  it("rejects unidentified environment", () => {
    assert.throws(
      () =>
        parseAsaasConfig({
          ASAAS_ENVIRONMENT: "staging",
          ASAAS_API_KEY: "k",
        }),
      AsaasConfigError,
    );
  });

  it("rejects missing API key", () => {
    assert.throws(
      () => parseAsaasConfig({ ASAAS_ENVIRONMENT: "sandbox" }),
      AsaasConfigError,
    );
  });

  it("rejects sandbox environment with production URL", () => {
    assert.throws(
      () =>
        parseAsaasConfig({
          ASAAS_ENVIRONMENT: "sandbox",
          ASAAS_API_KEY: "k",
          ASAAS_BASE_URL: PRODUCTION_BASE_URL,
        }),
      AsaasConfigError,
    );
  });

  it("rejects production environment with sandbox URL", () => {
    assert.throws(
      () =>
        parseAsaasConfig({
          ASAAS_ENVIRONMENT: "production",
          ASAAS_API_KEY: "k",
          ASAAS_BASE_URL: SANDBOX_BASE_URL,
        }),
      AsaasConfigError,
    );
  });

  it("rejects sandbox env with production-only key slot", () => {
    assert.throws(
      () =>
        parseAsaasConfig({
          ASAAS_ENVIRONMENT: "sandbox",
          ASAAS_API_KEY_PRODUCTION: "prod-slot-key",
        }),
      AsaasConfigError,
    );
  });

  it("rejects mixed sandbox and production key slots", () => {
    assert.throws(
      () =>
        parseAsaasConfig({
          ASAAS_ENVIRONMENT: "sandbox",
          ASAAS_API_KEY_SANDBOX: "s",
          ASAAS_API_KEY_PRODUCTION: "p",
        }),
      AsaasConfigError,
    );
  });

  it("rejects sandbox env when the production key slot is set even with a generic key", () => {
    assert.throws(
      () =>
        parseAsaasConfig({
          ASAAS_ENVIRONMENT: "sandbox",
          ASAAS_API_KEY: "generic",
          ASAAS_API_KEY_PRODUCTION: "prod-slot-key",
        }),
      AsaasConfigError,
    );
  });

  it("rejects production env when the sandbox key slot is set even with a generic key", () => {
    assert.throws(
      () =>
        parseAsaasConfig({
          ASAAS_ENVIRONMENT: "production",
          ASAAS_API_KEY: "generic",
          ASAAS_API_KEY_SANDBOX: "sandbox-slot-key",
        }),
      AsaasConfigError,
    );
  });

  it("binds sandbox to the sandbox host", () => {
    const cfg = parseAsaasConfig({
      ASAAS_ENVIRONMENT: "sandbox",
      ASAAS_API_KEY: "fixture-local-key-do-not-send",
    });
    assert.equal(cfg.environment, "sandbox");
    assert.equal(cfg.baseUrl, SANDBOX_BASE_URL);
  });

  it("binds production to the production host", () => {
    const cfg = parseAsaasConfig({
      ASAAS_ENVIRONMENT: "production",
      ASAAS_API_KEY: "fixture-local-key-do-not-send",
    });
    assert.equal(cfg.environment, "production");
    assert.equal(cfg.baseUrl, PRODUCTION_BASE_URL);
  });
});
