# Delivery OS vertical slice

This directory is the Governance-owned operational destination for an accepted
CONFENGE sale. It is deliberately narrow: `CFG-DIAG-EXP-v1`, synthetic/redacted
data, one append-only Work Order event stream and a read-only Control Center
projection.

## Boundaries

- Warmbly owns QCO/opportunity, Proposal v1, acceptance and the
  `confenge.delivery_order_requested.v1` producer.
- Governance validates financial gate, readiness and capacity before creating
  `confenge.work_order.v1`.
- SQLite is the durable minimum for the canary. `work_order_events` is the
  append-only truth and `work_order_projection` is disposable.
- The Control Center copies the Work Order read model. It exports no command and
  cannot derive delivery state locally.
- Synthetic financial evidence is always `received_revenue=false`. No Asaas,
  checkout, email or customer endpoint is called.

## Work Order state machine

`AWAITING_INPUTS -> READY -> IN_PROGRESS <-> BLOCKED -> QA -> READY_TO_DELIVER -> DELIVERED -> ACCEPTED -> CLOSED`

A failed QA review returns `QA -> IN_PROGRESS`. Missing identity, hash, version,
onboarding, financial gate, readiness, capacity, inputs, owner, artifact or
explicit acceptance fails closed.

The business key is:

`proposal_id + proposal_version + accepted_snapshot_hash + deliverable_id + deliverable_version`

Its unique SQLite constraint and deterministic ID make repeated transport and
replay converge on exactly one Work Order.

## Focused verification

```bash
python3 -m pytest -q tests/test_delivery_contracts.py tests/test_work_order.py
npm --prefix control-center run typecheck --workspace=@confenge/control-center-delivery
npm --prefix control-center run test --workspace=@confenge/control-center-delivery
```

The end-to-end canary command and its manifest are documented alongside
`delivery/canary.py`.
