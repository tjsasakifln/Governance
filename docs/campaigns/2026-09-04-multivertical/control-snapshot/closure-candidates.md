# Closure candidates

Campaign 16 does **not** close parent issues merely because a PR merged. This list is a photograph of what is already terminal vs what must stay open. `observed_at`: `2026-09-04T23:38:42Z`.

## Already terminal (do not reopen)

| repo | item | GitHub state | why terminal | residual elsewhere | observed_at |
|---|---|---|---|---|---|
| extra-cli | PR#539 | MERGED | Live Intelligence W2 export/`company_ref`/event feed landed `f943214a` 2026-09-04T00:50:44Z | extra-cli#530 remains PARTIAL | 2026-09-04T23:38:42Z |
| extra-cli | PR#543 | MERGED | Commercial-plane authority `3919f4d9` 2026-09-04T21:33:47Z | Governance#1 remains OPEN | 2026-09-04T23:38:42Z |
| web-cfg | PR#586 | MERGED | Runtime subset `89b081a` 2026-09-04T19:21:26Z | #536 LCP HOLD; #442/#443/#410 live cutover | 2026-09-04T23:38:42Z |
| web-cfg | issue#563 | CLOSED completed 2026-09-04T16:06:12Z | Consumer ACK of official live snapshot recorded on extra-cli#530 | extra-cli#530 producer still OPEN | 2026-09-04T23:38:42Z |
| warmbly | issue#47 | CLOSED completed 2026-09-04T03:09:45Z | Commercial-state/queue issue closed with merged PRs | Warmbly#260 is the live INTEL_WATCH residual | 2026-09-04T23:38:42Z |
| meetcfg | PR#2 | MERGED | Fail-closed Warmbly pull/list/session bind is on main `26f79e3f` | meetcfg#1 acceptance still OPEN (reopened) | 2026-09-04T23:38:42Z |
| Governance | PR#166 | MERGED | NET_NEW_INBOUND_HANDRAISER-v1 materialized on main `230d73a` | Governance#65 remains OPEN until E2E | 2026-09-04T23:38:42Z |

## Not closure candidates (keep OPEN)

| repo | item | why not closed | campaign 16 action | observed_at |
|---|---|---|---|---|
| extra-cli | #530 | PARTIAL: Warmbly official envelope ACK pending; body stale; producer terminal proof not met | Contemporary state comment; no close | 2026-09-04T23:38:42Z |
| warmbly | #260 | PARTIAL: canary ≠ official envelope | Contemporary state comment; no close | 2026-09-04T23:38:42Z |
| Governance | #1 | PARTIAL: extra-cli#543 does not satisfy catalog/Asaas/checkout DoD | Contemporary state comment; no close | 2026-09-04T23:38:42Z |
| Governance | #65 | NOW: admission E2E not terminal; merged PRs ≠ acceptance | no close | 2026-09-04T23:38:42Z |
| web-cfg | #61 | NOW: inbound epic; stale NOW-order only | Contemporary state comment; no close; no new epic | 2026-09-04T23:38:42Z |
| web-cfg | #577–#588 | Owner issues of campaigns 02–14 / B2G page; no terminal evidence | **Do not close.** #588 classified LATER vs private canary 09 | 2026-09-04T23:38:42Z |
| web-cfg | #536 #535 #544 #548 #549 #522 #523 #524 | Eight open PRs; campaign 01 | **Do not comment or close** | 2026-09-04T23:38:42Z |
| extra-cli | #531 | LATER independent PR | no close | 2026-09-04T23:38:42Z |
| extra-cli | #468 #469 | HOLD blocked incident/contact-discovery | no close; no SMTP | 2026-09-04T23:38:42Z |
| extra-cli | #542 | DECISION_ONLY “não implementar” | no close; no implementation | 2026-09-04T23:38:42Z |
| warmbly | #43 #155 #117 | HOLD/NOW; SMTP not authorized | no close | 2026-09-04T23:38:42Z |
| meetcfg | #1 | NOW consumer envelope | no close because PR#2 merged | 2026-09-04T23:38:42Z |
| lead-recovery / Inbound / outreach | n/a | already zero open work | do not reactivate; nothing to close | 2026-09-04T23:38:42Z |

## Unequivocally superseded references (comment only)

These are **references**, not issues to auto-close:

- extra-cli#530 body sentence that #539 is still open
- warmbly#260 body sentence that #530/#539 are still concluding
- web-cfg#61 NOW-order step that waits on open PR#539
- prompt wording that extra-cli#531 is site migration

Campaign 16 posts “Contemporary state” comments. It does not wipe bodies. It does not close #577–#588. It does not create a product issue for canary 09. It does not create a new epic while #577 / web-cfg#61 / Governance#65 / (closed) Warmbly#47 / Governance#1 already own.
