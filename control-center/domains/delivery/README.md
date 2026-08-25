# CONFENGE Delivery OS — Work Order v1

This workspace is the single execution authority for delivery after a versioned
commercial acceptance. It is not a CRM, billing ledger, catalog, data lake,
timesheet or binary artifact store.

The public resources are `confenge.work_order.v1` and
`confenge.work_order_event.v1`. Every mutation is an append-only event with an
actor, reason vocabulary, literal evidence reference, UTC timestamp,
idempotency key, correlation/causation and optimistic `expected_version`.
PostgreSQL keeps conflicting or out-of-order writes in
`work_order_event_holds`; it never guesses their order. `work_orders` and
`v_work_order_projection` are disposable read models rebuilt from the event
stream.

Creation fails closed unless accepted-snapshot identity, financial gate and
delivery readiness are proven. Production cannot start before required inputs
are received/waived and a responsible owner exists. QA, immutable artifact
references, human delivery and client acceptance are separate gates. A
nonconformity or change request never mutates the accepted commercial snapshot.

Business due dates are derived once from a pinned calendar version/timezone and
stored on the event. Replay reproduces the same value; no UI recalculates SLA.
The sandbox canary in the tests is `synthetic=true` and performs no checkout,
email, client delivery or provider mutation.
