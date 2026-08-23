# ADR-CC-002: Canonical weekly revenue chain

- **Status:** Accepted for sandbox and read-model use
- **Date:** 2026-08-22
- **Packages:** `control-center/contracts/`, Warmbly CONFENGE intelligence

## Context

The weekly commercial view needs to follow one account from opportunity and offer through proposal, charge, and payment. Transport IDs and display names are not stable business identities. A missing financial event is also not a measured zero.

## Decision

One opaque `correlation_id` binds six explicit IDs: `account_id`, `opportunity_id`, `offer_id`, `proposal_id`, `charge_id`, and `payment_id`. A free-form company or contact name is never accepted as a canonical key. Missing IDs and facts are the literal `UNKNOWN`.

The Control Center projects, validates, and visualizes the chain. Warmbly owns commercial action and outcome. Asaas remains the authority for charge and payment facts. Governance remains the catalog and terms authority. The projection is read-only and cannot create, alter, refund, or cancel a charge.

Each observed text or money fact carries `availability: OBSERVED`. An unavailable fact is exactly `{ "availability": "UNKNOWN" }`; it cannot carry `amount_cents: 0`. A real observed zero is valid only when the source explicitly marks the money fact observed.

Human commercial decisions are limited to `GO`, `NO-GO`, and `WAIT`. Provider events cannot infer them. Synthetic rows are labeled and excluded from the default real-only Warmbly query.

## Consequences

- The projector drops rows without a safe opaque correlation and converts malformed optional identities to `UNKNOWN`.
- The Control Center may show the operational chain but cannot become a second CRM or financial ledger.
- A sandbox replay may prove the software path. Production remains gated until a human decision and a real Asaas event are observed.
- Schema changes to the Warmbly identity-link table ship with reversible up/down migrations in Warmbly.
