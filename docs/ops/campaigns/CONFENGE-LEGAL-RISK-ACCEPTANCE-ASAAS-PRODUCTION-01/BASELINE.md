# BASELINE — CONFENGE-LEGAL-RISK-ACCEPTANCE-ASAAS-PRODUCTION-01

Recorded 2026-08-18, America/Sao_Paulo, before any edit of this campaign.

## Repositories and SHAs

| Repo | Workspace checkout (pre-campaign) | origin/main | Isolated worktree | New branch |
|---|---|---|---|---|
| Governance | `ff0bce2f367469548da2accbf35cebd347079eee` (`campaign/CONFENGE-LEGAL-BOOTSTRAP-V1-01`) | `b8644e1cf83987b5301d020be1ec79b2861859d5` | `/home/tjsasakifln/code/confenge/Governance-wt-founder-approved` | `campaign/CONFENGE-LEGAL-RISK-ACCEPTANCE-ASAAS-PRODUCTION-01` |
| web-cfg | `1e9b6ca8f5dc65e17e0bca8d7b81a1e395cc6ea4` (`feat/web-010-editorial-policy`) — **no** `scripts/offers/**` on this branch | `c5c5492066a6f324c146326579ca1c3795ae1a42` — **has** offers engine | `/home/tjsasakifln/code/confenge/web-cfg-wt-asaas-prod` | `campaign/CONFENGE-LEGAL-RISK-ACCEPTANCE-ASAAS-PRODUCTION-01` |
| warmbly | `9cadc94a1ea8428d33a6c680285a4a422c46ad` (`feat/confenge-inbound-last-mile`, dirty inbound work) | `dd4490825f01350add510f41746500947d83f850` | `/home/tjsasakifln/code/confenge/warmbly-wt-asaas-prod` | `campaign/CONFENGE-LEGAL-RISK-ACCEPTANCE-ASAAS-PRODUCTION-01` |

Worktrees created from `origin/main`. Sibling trees are inspection-only.

## Branch protection and deploy

| Repo | Protection | Deploy observed |
|---|---|---|
| Governance `main` | not protected (HTTP 404) | n/a (authority repo) |
| web-cfg `main` | required checks: `site-ci`, `pSEO quality gates` | no GitHub deployments listed |
| warmbly `main` | not protected (HTTP 404) | consumer deploy is a later step; no production webhook apply until consumer is shown deployable |

## Authority reuse

| Surface | Role | State at baseline |
|---|---|---|
| Governance #1 | residual canonical governance record | OPEN. Comments record offer authority, provisional-v1, and that professional review remains pending. Must stay OPEN. |
| web-cfg #88 | delivery parent (contratação/checkout) | OPEN (`[P1][conversion] Orquestrar intenção → next best action → pipeline`). There is no PR #88. |
| Warmbly #47 (fork `tjsasakifln/warmbly`) | commercial reconciliation consumer | OPEN. Additive Asaas/offer scope already absorbed. Upstream `warmbly/warmbly#47` is an unrelated developers-page PR and is **not** this authority. |

Merged Governance legal history on `origin/main`:

- PR #4 `5da020d` — `commercial/legal/provisional-v1/` (frozen)
- PR #5 `b8644e1` — `commercial/legal/diagnostico-v1.1/` (`READY_FOR_PRIVATE_NEGOTIATION`; **not** this campaign’s live authority)

`diagnostico-v1.1` still carries `HUMAN_DECISION_REQUIRED` for identity, foro, retenção and responsável fiscal, and keeps `production_checkout_enabled = false`. It is preserved, not reused as production authority.

## Owned surfaces (do not reimplement)

### Governance

- `commercial/legal/provisional-v1/` — immutable
- `commercial/legal/diagnostico-v1.1/` — prior private-negotiation package; not this authority
- `commercial/offers/catalog.v1.json` + `catalog.public.v1.json`
- `commercial/gates/production-gates.v1.json` — **global** fail-closed (`production_checkout_enabled=false`, `public_activation_approved=false`). Provisional validator **requires** these globals to stay false. Recurring stays gated. Limited diagnosis production will be authorized by `founder-approved-v1`, not by flipping the portfolio gate to `LEGAL_APPROVED`.
- `scripts/validate_legal_provisional.py`, `scripts/validate_commercial_authority.py`

### web-cfg (`origin/main`)

- `scripts/offers/**` (registry, eligibility, events, persist, flags, journey, terms, sandbox store)
- `scripts/offers/providers/asaas-sandbox.cjs`, `config.cjs`, `status-machine.cjs`
- `netlify/functions/offer-eligibility.cjs`
- `netlify/functions/offer-checkout-sandbox.cjs`
- `netlify/functions/asaas-webhook-sandbox.cjs`
- `tests/offers/asaas-sandbox/test_asaas_sandbox.mjs`
- `data/offers/flags.json`

Production adapter must be a **separate** module. Do not hybridize `asaas-sandbox.cjs`.

### warmbly (`origin/main`)

- `confenge.commercial_event.v1` / offer revenue consumer (`internal/app/confenge/intel/commercial.go`, `offer_revenue_test.go`, exceptions, scoreboard)
- Campaign `CONFENGE-WARMBLY-OFFER-REVENUE-04`
- Existing mapper may collapse `CONFIRMED` → `PAYMENT_RECEIVED`. That split is in scope if still present.

## Corporate identity verification (2026-08-18)

Public CNPJ registry lookup (`brasilapi.com.br/api/cnpj/v1/52407089000109`):

| Field | Value |
|---|---|
| razão social | `CONFENGE SERVICOS DE DESENHOS TECNICOS LTDA` |
| CNPJ | `52.407.089/0001-09` |
| endereço | PREFEITO OSMAR CUNHA, 416, SALA 1108, CENTRO, FLORIANÓPOLIS/SC, CEP 88015-100 |
| situação | ATIVA |
| marca pública used | CONFENGE |
| source class | `PUBLIC_CNPJ_REGISTRY_LOOKUP` |
| canonical hash of recorded fields | `sha256:91bc707d8135e6599379e9f0ef5624a2089ea2cd315801d9a9607a5323d94ca9` |

Not versioned: contrato social, documento pessoal, procuração. Lookup does **not** prove specific internal signing powers of Tiago Jun Sasaki.

## Asaas official revalidation (2026-08-18)

Primary: https://docs.asaas.com/docs/introduction-1.md and https://docs.asaas.com/reference/create-new-checkout

- Hosts: production `https://api.asaas.com/v3`, sandbox `https://api-sandbox.asaas.com/v3`
- Auth header: `access_token`
- Checkout create: `POST /v3/checkouts`
- `billingTypes` allowed on Checkout: `PIX`, `CREDIT_CARD` only
- `chargeTypes`: `DETACHED`, `RECURRENT`, `INSTALLMENT`
- `minutesToExpire`: official 10–1440; campaign policy 60–1440
- Callback is navigation; Webhooks are financial truth
- **BOLETO is omitted** from hosted Checkout. Official Checkout `billingTypes` do not list `BOLETO`. Inventing it would be a defect.

## Real blockers at baseline

1. No founder-approved limited-production legal package (`founder-approved-v1` does not exist).
2. `diagnostico-v1.1` still blocks identity/foro/retenção/fiscal and forbids public checkout.
3. Global production gates stay fail-closed (required by frozen validators); limited diagnosis go-live must not flip recurring or claim `LEGAL_APPROVED`.
4. web-cfg production adapter, acceptance-before-checkout function, and diagnosis public journey do not exist on `origin/main`.
5. Production Asaas API key / dedicated webhook token are not assumed present. Honest fallback: `FOUNDER_ACTION_REQUIRED_ASAAS_PRODUCTION.txt`.
6. No fabricated production customer, acceptance, checkout or payment is allowed.
7. SmartLic and extra-cli are out of scope and must not be edited.

## Token this campaign will emit (not present at baseline)

`FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW_2026_08_18`
