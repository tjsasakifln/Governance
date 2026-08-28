# ADR-CFG-FIRST-TOUCH-ROUTING-001

Status: accepted
Effective: 2026-08-25
Authority: founder decision recorded in [Governance #129](https://github.com/tjsasakifln/Governance/issues/129)
Runtime tracking: [Warmbly #41](https://github.com/tjsasakifln/warmbly/issues/41)

## Decision

The founder delegates per-message approval for an eligible outbound first touch
to the executing agent or system under `CFG-FIRST-TOUCH-ROUTING-v1`. A delegated
decision is recorded as `DELEGATED_POLICY_APPROVE`; it is never represented as a
human click or as `HUMAN_APPROVE`.

Every hard gate in
`commercial/outbound/cfg-first-touch-routing.v1.json` must pass at the same
version and source run. Any `UNKNOWN`, conflict, failure or material drift
invalidates the delegated decision and routes the item to the existing human
exception path.

The policy covers first-touch approval and scheduling only. It does not
authorize follow-ups or provider dispatch. The operational canary must preserve
the kill switch and global dispatch pause and must record zero SMTP/provider
send mutations.

The global dispatch pause and kill switch are revocable transport controls, not
material message inputs. Their activation defers or blocks provider handoff but
does not erase an otherwise valid approval. This distinction permits a
zero-SMTP canary to reach the existing `QUEUED` state while dispatch remains
paused; neither control may ever be bypassed.

## Superseded decision

Before this ADR, Governance #129 and Warmbly #41 required human review or a
human cohort/policy authorization before every first touch could advance. That
decision remains historical and still governs messages outside this policy,
but it no longer applies to first touches that satisfy every v1 hard gate.

## Architecture consequence

extra-cli remains the authority for target identity, typed buyer/supplier role,
recipient and evidence. Warmbly remains the authority for drafts, approvals,
scheduling, queue, suppression, idempotency, readback and transport controls.
Governance owns only the versioned policy. No parallel CRM, lead base, queue,
scheduler or raw PNCP reinterpretation is introduced.

## Additive note — v2 (2026-08-27)

`CFG-FIRST-TOUCH-ROUTING-v2` is an additive authority. v1 remains
machine-readable with its original semantics, including the monolithic
current-source-run gates. This ADR's v1 decision is not rewritten.

v2 separates source operational health (crawler / target-fit / publication /
age; `FRESH` / `DEGRADED` / `STALE` / `UNKNOWN`) from commercial authority
(the last fully proven population binding) from transport authority
(mailbox, pause, kill switch, window). Operational source degradation does
not automatically revoke a previously proven commercial authorization.
v2 activates only on exact version match; unknown or missing version is
fail-closed. The policy still does not authorize SMTP or provider dispatch.
