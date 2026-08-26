# Delivery OS vertical slice

This directory is the executable P0 cut of `tjsasakifln/Governance#121`,
`tjsasakifln/Governance#122` and `tjsasakifln/Governance#123` for the single
synthetic/redacted `CFG-DIAG-EXP-v1` path.

## Boundaries

- Warmbly owns QCO/opportunity, Proposal v1, acceptance and the
  `confenge.delivery_order_requested.v1` producer.
- web-cfg remains authoritative for the 54 public deliverable identities and
  the `expansion_package` composition.
- Governance readiness/capacity validates the admission before the canonical
  Control Center Delivery domain creates `confenge.work_order.v1`.
- PostgreSQL Work Order events are the sole append-only execution truth. The
  SQLite database in this directory is a synthetic `MODEL_ONLY` lifecycle; it
  rejects real reservations and never becomes a production ledger.
- The policy ceiling of 50 is never treated as staffed capacity.
- Synthetic evidence always has `received_revenue=false`. No Asaas, checkout,
  email or customer endpoint is called.

## Honest readiness inventory

`readiness-54.fail-closed.v1.json` contains exactly 54 identity/pointer/hash
stubs generated from a supplied web-cfg registry. All remain `UNKNOWN`; names,
prices, public copy, scopes and routes are not copied into a second catalog.

`readiness-54.fail-closed.v2.json` is the additive operational matrix. It pins
web-cfg #329/#343 and adds owner, blocker, evidence, next action, observation
freshness and expiry to each of the same 54 identities. All 54 remain
`UNKNOWN`; freshness of the identity observation does not imply readiness.

Regenerate deterministically with:

```bash
python3 scripts/generate_delivery_readiness.py \
  /path/to/web-cfg/data/commercial/deliverables-registry.v1.json \
  --authority-ref 'github://tjsasakifln/web-cfg@6c3415cb05b3423d87592eba39d3a0ec61bde0b1/data/commercial/deliverables-registry.v1.json' \
  --source-revision 6c3415cb05b3423d87592eba39d3a0ec61bde0b1 \
  --generated-at 2026-08-25T12:00:00Z
```

`CFG-DIAG-EXP-v1` is a separate operational aggregate over D02-D08, not a 55th
public row. Its profile is `PRODUCTION_READY` only for the synthetic sandbox.
It becomes `DELIVERY_VALIDATED` only after a closed Work Order with passed QA,
sandbox delivery and explicit sandbox acceptance.

## Work Order invariant and state machine

`AWAITING_INPUTS -> READY -> IN_PROGRESS <-> BLOCKED -> QA -> READY_TO_DELIVER -> DELIVERED -> ACCEPTED -> CLOSED`

A failed review follows `QA -> REWORK_REQUIRED -> IN_PROGRESS`. Missing identity, hash, version,
onboarding, finance, readiness, capacity, input, owner, artifact or explicit
acceptance fails closed.

The unique business key is:

`proposal_id + proposal_version + accepted_snapshot_hash + deliverable_id + deliverable_version`

The canonical TypeScript aggregate and PostgreSQL event store provide optimistic
locking, deterministic IDs, strict event order and rebuildable projections.

## Stable API

```python
from delivery.canary_gate import CanaryGate
from delivery.capacity import CapacityLedger, evaluate_admission, evaluate_admission_v2
from delivery.production.cfg_diag_exp import produce_sandbox_artifact, run_qa
from delivery.readiness import promote_to_delivery_validated
```

`evaluate_admission` is the preserved v1 canary contract.
`evaluate_admission_v2` is the canonical, pure admission engine documented in
`ADMISSION-CONTROL.md`; its result directly feeds the only v2 read-only
capacity projection.

`CapacityLedger` exercises only synthetic/model states:
`HELD -> COMMITTED -> RELEASED | EXPIRED`, plus
`RECONCILIATION_REQUIRED` for ambiguous cancellation/refund/timeout. It is not
a billing, Work Order or production reservation ledger. The Control Center
owns no truth here; it only renders `confenge.capacity_projection.v2`.

## Verification

```bash
python3 -m pytest -q \
  tests/test_delivery_contracts.py \
  tests/test_delivery_readiness.py \
  tests/test_delivery_capacity.py \
  tests/test_capacity_admission_v2.py \
  tests/test_delivery_canary_gate.py
npm --prefix control-center run typecheck --workspace=@confenge/control-center-delivery
npm --prefix control-center run test --workspace=@confenge/control-center-delivery
npm --prefix control-center run test:delivery-canary
```

The end-to-end command is `python3 -m delivery.canary`; it can execute the
Warmbly proposal producer or consume its byte-pinned golden fixture.
