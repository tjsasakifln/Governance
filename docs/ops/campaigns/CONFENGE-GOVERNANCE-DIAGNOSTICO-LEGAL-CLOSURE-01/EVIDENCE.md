# EVIDENCE — CONFENGE-GOVERNANCE-DIAGNOSTICO-LEGAL-CLOSURE-01

## PR #4 (provisional framework)

Merged: https://github.com/tjsasakifln/Governance/pull/4
Merge commit: `5da020d75342d6f17e64ec4f638251108626e5c4`
Pre-merge status: `PROVISIONAL_PACKAGE_READY_FOR_FOUNDER_DECISIONS`
CI green: Actions runs `32150020688` and `32149988427` (`validate` SUCCESS)
17 files; Extra / `HISTORICAL_LIGHTHOUSE` / `CFG-EXC-EXTRA` absent
`amount_cents = 800000`; fail-closed flags false; `legal_terms_forum = UNKNOWN`

Frozen prior hash (two identical validator runs):

```
LEGAL_PACKAGE_HASH sha256:53cb908af9eeaaa1d7097c322394440cff329ff9bd7fb9522ab922801f0cd150
```

## Successor `diagnostico-v1.1`

Founder-decided package points at the prior hash above.
`write-hashes` does not rewrite `provisional-v1`.
Classification of the ten original ids is machine-readable in `DECISION_CLASSIFICATION.json`.

Command:

```bash
python scripts/validate_legal_provisional.py
python scripts/validate_commercial_authority.py
python -m pytest tests/test_legal_provisional.py tests/test_commercial_authority.py -q
```

## Classification (not collapsed)

| Claim | Class | Evidence |
|---|---|---|
| PR #4 integrated as provisional framework | MERGED | merge `5da020d` |
| Successor exists and does not mutate prior hashes | CODE_PROVEN | `prior_package_hash` pin + `test_write_hashes_does_not_mutate_prior_package` |
| Six founder commercial decisions recorded as founder baseline, not `LEGAL_APPROVED` | CODE_PROVEN | `DECISION_CLASSIFICATION.json` + shipped `assert_classification` |
| Four remaining pendings have professional owner + required evidence | CODE_PROVEN | `PROFESSIONAL_GATES.md` + classification |
| Checkout/publication blocked while professional gate pending | CODE_PROVEN | `assert_pending_gates_block_activation` |
| Invented CNPJ / foro / numeric teto fail | CODE_PROVEN | shipped `assert_no_invented_entity_fills` |
| Checkout/callback is not aceite | CODE_PROVEN | shipped `assert_checkout_is_not_acceptance` |
| Terms do not promise result | CODE_PROVEN | shipped `assert_no_resultado_promise` |
| Extra leak absent | CODE_PROVEN | shipped `assert_no_extra_leak` |
| Counsel/accountant short packets | CODE_PROVEN | `LEGAL_COUNSEL_HANDOFF.md`, `ACCOUNTANT_HANDOFF.md` |
| `STATUS_FINAL` = private negotiation + three `NOT_*` | CODE_PROVEN | package + campaign copies |
| Deployed / live / real money / NFS-e / Asaas | NO_GO | flags remain false |
| Counsel, accountant, entity document | UNKNOWN | tokens remain |

## Explicit non-events

No production API key, production webhook, real product, checkout, charge, refund, cancellation, NFS-e, customer contact, Extra contract change, or public offer publication occurred in this campaign. Governance #1 stays open.
