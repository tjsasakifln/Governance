# EVIDENCE — CONFENGE-GOV-OFFER-AUTHORITY-V1-01

Authority hash (two identical validator runs):

```
sha256:bc5aa6b30b48768bae98906d820a44188fa095b8a80f3f84643a974fcf40a0fc
```

Command:

```bash
python scripts/validate_commercial_authority.py
python -m pytest tests/test_commercial_authority.py -q
```

Both commands were executed twice from the worktree root. Validator stdout was identical. Pytest: 19 passed / 19 passed.

## Classification (not collapsed)

| Claim | Class | Evidence |
|---|---|---|
| Canonical catalogs, terms, capacity, gates, ADR, schemas, validator and tests exist in this worktree | CODE_PROVEN | files under `commercial/`, `schemas/`, `scripts/`, `tests/`, `decisions/` |
| Integer centavos, 180=6×parcela, 365=12×parcela, Flex without invented end | CODE_PROVEN | shipped catalogs + `tests/test_commercial_authority.py` |
| Extra historical condition cannot serialize to public catalog; no public R$ 10.000/mês | CODE_PROVEN | `commercial/exceptions/extra-historical.v1.json` + public catalog + tests |
| Fail-closed flags (checkout/webhook/money/publication false; sandbox/manual true) | CODE_PROVEN | `authority-manifest.v1.json` + `production-gates.v1.json` |
| `ACTIVE` rejected while required gates are `UNKNOWN` | CODE_PROVEN | validator + adversarial test |
| Hash reproducible across two runs; no build clock in `content_hash` | CODE_PROVEN | identical `AUTHORITY_HASH` lines |
| CI green on GitHub Actions | CI_PROVEN | push run 32053336990 and PR run 32053358442 both `success` (validate + adversarial tests). Not skipped. |
| Merged to `main` | MERGED | PR https://github.com/tjsasakifln/Governance/pull/2 merged at `bd40aa7dd2d875ae8a5c4688e713acba87aa964f`. GitHub auto-closed #1 on the phrase “Do not close #1”; issue was reopened and remains OPEN. |
| Deployed / live / real external payment | NO_GO | no Asaas mutation, no checkout, no NFS-e, no publication |
| Counsel, accountant, staffed capacity, brand publication, finance operator | UNKNOWN | gates remain `UNKNOWN`; not fabricated |
| Extra contract change | NO_GO | private registry only; no addendum |

## Consumers

- web-cfg #88 — pin `AUTHORITY_HASH` via `commercial/CONSUMER-HANDOFF.md`
- Warmbly #47 — same pin; created provider objects ≠ received revenue

## Explicit non-events

No production API key, production webhook, real product, checkout, charge, refund, cancellation, NFS-e, customer contact, Extra contract change, or final public offer publication occurred in this campaign.
