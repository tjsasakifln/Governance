# Asaas connector (Control Center)

Read-only finance collector for the Confenge Control Center. This package **gets**
customers, charges, subscriptions, PIX transactions and (when permitted)
balance / extract, then normalizes them into an in-memory `FinanceSnapshot`.

It is **not** chat, **not** an ERP, **not** Warmbly, and **not** a billing
engine. It does not create, charge, refund, cancel, update, pay, or register
webhooks. Financial mutation of Asaas is out of scope and mechanically refused.

Governance remains the strategic/canonical authority. Warmbly remains the
operational commercial/CRM authority. Asaas is a provider of payment state.

## Decisions

- HTTP surface is **GET-only** against an explicit **sandbox XOR production**
  base URL. Unidentified environment, mixed sandbox/prod URL+key, or missing
  API key **fail closed**.
- Sandbox host: `https://api-sandbox.asaas.com`
- Production host: `https://api.asaas.com`
- Paths are under `/v3/...`. Auth header is `access_token`. `User-Agent` is
  required (`ConfengeControlCenter-AsaasConnector/1.0`).
- GET bodies are empty (Asaas returns 403 otherwise).
- Money is stored as **integer cents + `BRL`**. Provider `value` is reais.
- Dates are stored as **UTC ISO-8601**. Date-only Asaas fields are midnight UTC
  of that calendar date. Presentation in `America/Sao_Paulo` is a UI concern.
- Every aggregated fact carries `source`, `observed_at`, `freshness_status`
  and `confidence` when set.
- Buckets **`contracted`, `billed`, `paid`, `received` are separate**.
- Asaas `CONFIRMED` / webhook `PAYMENT_CONFIRMED` is **paid-not-received**.
  Founder rule: `PAYMENT_CONFIRMED` **não é receita**. `PAYMENT_RECEIVED` is
  money received. This package never labels a provider object as
  receita/revenue.
- Cancelled = payment `deleted` / `PAYMENT_DELETED` / subscription `INACTIVE`
  (or `EXPIRED`).
- Collectors are **idempotent** on `asaas:{environment}:{kind}:{provider_id}`.
  Duplicate list rows or webhooks collapse to one entity.
- List GET is canonical. A webhook that contradicts the list (e.g. webhook
  `PAYMENT_RECEIVED` vs list `CONFIRMED`) is an **inconsistency** /
  `freshness_status=inconsistent`. It does **not** promote confirmed → received.
- `GET /v3/finance/balance` and `GET /v3/financialTransactions` are optional:
  HTTP 401/403 omit them with `freshness_status=absent`. The amount is never
  invented as zero.
- Secrets are read from env only. Never written to git, logs, URLs, analytics,
  fixtures, or a client bundle.
- Customer PII (name, email, CPF/CNPJ, phone) is dropped at parse time.
- Sibling Control Center persistence/context packages are not imported. The
  snapshot is a **local contract** for a later convergence campaign.

## GET allowlist

The client refuses every method other than GET and every path not in this list
(plus retrieve-by-id variants). Mutation fragments (`/refund`,
`/payWithCreditCard`, `/webhook`, `/checkouts`, …) are denied even as GET.

- `GET /v3/customers` and `GET /v3/customers/{id}`
- `GET /v3/payments` and `GET /v3/payments/{id}`
- `GET /v3/subscriptions` and `GET /v3/subscriptions/{id}`
- `GET /v3/pix/transactions` and `GET /v3/pix/transactions/{id}`
- `GET /v3/finance/balance`
- `GET /v3/financialTransactions`

## Environment variables (names only)

| Name | Role |
|---|---|
| `ASAAS_ENVIRONMENT` | Required. Exactly `sandbox` or `production`. |
| `ASAAS_API_KEY` | Required unless the matching slot below is set. Never commit. |
| `ASAAS_API_KEY_SANDBOX` | Optional sandbox-only slot. Cannot be combined with the production slot. |
| `ASAAS_API_KEY_PRODUCTION` | Optional production-only slot. Cannot be combined with the sandbox slot. |
| `ASAAS_BASE_URL` | Optional override; must equal the canonical host for `ASAAS_ENVIRONMENT`. |
| `ASAAS_USER_AGENT` | Optional. Default `ConfengeControlCenter-AsaasConnector/1.0`. |

Do not put the API key in a URL, query string, log line, or fixture.

## How to run

From this directory:

```bash
npm install
npm test
npm run typecheck
npm run consumer -- /tmp/asaas-consumer-out
```

`npm test` is the local assertion suite (fixtures, no network).

`npm run consumer` is a **fresh consumer** of the shipped `collectFinanceSnapshot`
entry. It ignores a live `ASAAS_API_KEY` in the process environment and always
uses `FixtureTransport`. It writes `consumer-1.json` / `consumer-2.json` plus
logs to the output directory.

Tests and the consumer must **not** call live Asaas.

## FinanceSnapshot contract (for later convergence)

Schema id: `control-center.finance-snapshot.v1`.

```ts
{
  schema_version: "control-center.finance-snapshot.v1";
  source: "asaas";
  environment: "sandbox" | "production";
  collected_at: string;          // UTC ISO
  observed_at: string;           // UTC ISO
  freshness_status: "fresh" | "stale" | "absent" | "inconsistent";
  confidence?: number;
  provenance: { source, observed_at, freshness_status, confidence? };
  buckets: {
    contracted: { cents, currency: "BRL", provider_ids, provenance };
    billed:     { cents, currency: "BRL", provider_ids, provenance };
    paid:       { cents, currency: "BRL", provider_ids, provenance };
    received:   { cents, currency: "BRL", provider_ids, provenance };
  };
  entities: {
    customers: FinanceEntity[];      // ids only, no PII
    charges: FinanceEntity[];        // pay_*
    subscriptions: FinanceEntity[];  // sub_*
    pix: FinanceEntity[];
    receivables: FinanceEntity[];    // empty if extract omitted
  };
  balance: { omitted: false, available: { cents, currency }, provenance }
         | { omitted: true, reason: string, provenance };
  observations: Array<{
    kind: "inconsistency" | "duplicate" | "absence" | "freshness" | "info";
    code: string;
    message: string;                 // provider ids, no PII
    provider_ids: string[];
    provenance: { source, observed_at, freshness_status, confidence? };
  }>;
}
```

Bucket reducers (charges unless noted):

| Bucket | Included |
|---|---|
| `contracted` | Active subscriptions' `value` + one-off (no subscription) PENDING/CONFIRMED/RECEIVED/OVERDUE charges |
| `billed` | Non-deleted charges |
| `paid` | `CONFIRMED`, `RECEIVED`, `RECEIVED_IN_CASH` |
| `received` | `RECEIVED`, `RECEIVED_IN_CASH` only |

Charge lifecycle: `pending | paid | received | overdue | refunded | cancelled | chargeback | other`.

Idempotency key: `asaas:{environment}:{kind}:{provider_id}`.

Live wiring later (this campaign does not run it):

```ts
import {
  parseAsaasConfig,
  DefaultFetchTransport,
  RecordingTransport,
  collectFinanceSnapshot,
} from "@confenge/control-center-asaas";

const config = parseAsaasConfig(process.env);
const snapshot = await collectFinanceSnapshot({
  config,
  transport: new RecordingTransport(new DefaultFetchTransport()),
});
```

`transport` is required. There is no hidden `fetch` default, so a test or
consumer cannot accidentally hit production.

## Out of scope

Checkout, NFS-e, transfers, bill payments, refunds, webhook registration,
multi-user IAM, writes under `commercial/`, `decisions/`, `scripts/`, root
README, Warmbly, web-cfg, extra-cli, or sibling `control-center/` packages.
