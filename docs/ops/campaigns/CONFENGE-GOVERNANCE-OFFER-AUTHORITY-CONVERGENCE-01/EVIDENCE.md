# EVIDENCE — CONFENGE-GOVERNANCE-OFFER-AUTHORITY-CONVERGENCE-01

Base: `origin/main` `4d4388ce7208ddac0f78576b69185bbaf2203d30`.

Search notes: last-72h origin/main, Governance#1 body+comments, commercial artifacts, web-cfg freeze, Warmbly outreach. No priced baixa-fricção SKU. v1 amounts unchanged. Diagnóstico overlay exists and does not flip portfolio gates.

Canonical artifacts:

- `commercial/offers/catalog.v1.json`
- `commercial/offers/catalog.public.v1.json`
- `commercial/offers/catalog.human.v1.md`
- `commercial/providers/asaas-mapping.v1.json`
- `commercial/FOUNDER-ASAAS-REGISTRATION.md`
- `commercial/CONSUMER-CONTRACT.md`
- `commercial/DECISIONS-CHANGELOG.md`
- `commercial/gates/diagnostico-limited-production.v1.json`
- `commercial/fixtures/consumer-catalog.example.v1.json`
- `commercial/compatibility/consumer-compatibility.v1.json`
- `commercial/fixtures/consumer-compatibility.ci.v1.json`

Validator: `python scripts/validate_commercial_authority.py`
Mapping copy-back: `python scripts/validate_commercial_authority.py --check-mapping <payload.json>`
Tests: `python -m pytest tests/test_commercial_authority.py tests/test_offer_convergence.py tests/test_commercial_mainline.py -q`

No Asaas API call. No secrets. No Extra republication. No SmartLic billing.
