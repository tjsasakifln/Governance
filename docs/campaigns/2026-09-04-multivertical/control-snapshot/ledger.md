# Control-tower ledger — CAMPAIGN_ID=16

Initial photograph. Not a background watcher. Goal 97 refreshes before integration.

- `observed_at` for GitHub facts: `2026-09-04T23:38:42Z`
- Oracle: authenticated `gh` + GitHub MCP against live GitHub / `origin/main`. Prompt issue/PR numbers are historical anchors only.
- Remote identity: `tjsasakifln/Governance` (raw remote URL not published).
- Branch: `chore/campaign-20260904-multivertical-control-snapshot-v3`
- Worktree: `/home/tjsasakifln/code/confenge/.worktrees/Governance/c20260904-16-control-snapshot`
- `BASE_SHA` = `INITIAL_MAIN_SHA` = `START_SHA` = `230d73a22a321112abe09b34a0d5fe743790b857`
- Classification vocabulary: `DONE` | `PARTIAL` | `NOW` | `HOLD` | `BLOCKED_EXTERNAL` | `SUPERSEDED` | `DECISION_ONLY` | `LATER`
- Invariants (test-only contracts): `outbound_eligible=false`, `auto_send=false`. Missing/divergent version or hash fails closed.

## WRITE_SET / DO_NOT_TOUCH_SET

**WRITE_SET**

- `docs/campaigns/2026-09-04-multivertical/control-snapshot/ledger.md`
- `docs/campaigns/2026-09-04-multivertical/control-snapshot/contract-dag.json`
- `docs/campaigns/2026-09-04-multivertical/control-snapshot/file-locks.json`
- `docs/campaigns/2026-09-04-multivertical/control-snapshot/superseded-references.md`
- `docs/campaigns/2026-09-04-multivertical/control-snapshot/closure-candidates.md`
- `docs/campaigns/2026-09-04-multivertical/control-snapshot/merge-readiness.md`
- `docs/campaigns/2026-09-04-multivertical/control-snapshot/branch-drift-risks.md`
- `docs/campaigns/2026-09-04-multivertical/control-snapshot/refresh-protocol.md`
- `tests/test_control_snapshot_campaign_20260904.py`
- `docs/integration/campaign-20260904/16/README.md`
- `docs/integration/campaign-20260904/16/ci-pytest-inclusion.fragment.md`
- `docs/integration/campaign-20260904/16/docs-index.fragment.md`

**DO_NOT_TOUCH_SET**

- `commercial/**`, `schemas/**`, `control-center/**`, `delivery/**`
- `.github/**`, `package.json`, lockfiles, `Makefile`, global scripts
- `README.md`, `docs/README.md`, `docs/ops/**`
- product/home/forms/queues/consumers; the eight web-cfg PRs (no comment/close)
- sibling campaign worktrees

## Contemporaneous main SHAs and counts

| repo | main SHA | main date | open PRs | open issues | observed_at |
|---|---|---|---:|---:|---|
| web-cfg | `89b081a8676d8a0b30747dfcb1477f21d9ac4dfb` | 2026-09-04T19:21:25Z | 8 | 34 | 2026-09-04T23:38:42Z |
| extra-cli | `3919f4d9af1363e2db641c7edadb8a8404874ec4` | 2026-09-04T21:33:47Z | 1 | 31 | 2026-09-04T23:38:42Z |
| warmbly | `8602ce4ae68e27080fa4431390194c09c2b76d06` | 2026-09-04T13:11:57Z | 0 | 9 | 2026-09-04T23:38:42Z |
| Governance | `230d73a22a321112abe09b34a0d5fe743790b857` | 2026-09-04T13:40:21Z | 0 | 18 | 2026-09-04T23:38:42Z |
| meetcfg | `26f79e3fd414b12e765b6ec243e47a90c8a9b226` | 2026-09-04T13:07:31Z | 0 | 7 | 2026-09-04T23:38:42Z |
| lead-recovery | `3791ae102e81ad4f4ad7963348f182d695fabf1b` | 2026-06-27T23:12:00Z | 0 | 0 | 2026-09-04T23:38:42Z |
| Inbound | `205ed13439b63101086e749bd7f7e33254854a3d` | 2025-07-11T03:17:51Z | 0 | 0 | 2026-09-04T23:38:42Z |
| outreach | `f5866073fcaa1f701f60bef9e5477806c07a7b48` | 2026-07-02T13:03:56Z | 0 | 0 | 2026-09-04T23:38:42Z |

## Owner matrix 01–15 + 97/98/99

| id | owner | primary issues/PRs |
|---|---|---|
| 01 | PRs/dependências | web-cfg #522 #523 #524 #535 #536 #544 #548 #549 |
| 02 | arquitetura/taxonomia | web-cfg #577 #578 |
| 03 | ofertas | web-cfg #583 #587 #588 |
| 04 | credenciais | web-cfg #581 #243 |
| 05 | conflitos | web-cfg #585 |
| 06 | policy Governance | Governance #65 (and residual ADR #1) |
| 07 | consumer Warmbly | warmbly #260 |
| 08 | captura | web-cfg #580 |
| 09 | canário privado | `private_project_technical_readiness_v1` (no product issue from campaign 16) |
| 10 | shell/global CSS | web-cfg #582 |
| 11 | hub local | web-cfg #579 |
| 12 | proof QA | web-cfg #531 |
| 13 | mensuração | web-cfg #529 |
| 14 | Meetcfg | meetcfg #1 |
| 15 | pré-mortem | campaign 15 worktree |
| 97 | shared registries/build/dependency integration | CI inclusion + docs index fragments |
| 98 | auditoria final | after 97 |
| 99 | promoção | human only; NO_DEPLOY here |

## P0/P1 blockers (sampled live)

- web-cfg P0 open: #577 #578 #580 #581 #582 #585 #243
- extra-cli P0 open: #530 #468
- warmbly P0 open: #43 (`NO_GO_SMTP`)
- Governance P0 open: #65 #1
- SMTP remains unauthorized: Warmbly #43/#155/#117 and extra-cli #468 do not grant transport

## Ledger

| repo | issue/PR | contemporaneous state | owner | dependency | blocker | next action | do-not-do | evidence | observed_at |
|---|---|---|---|---|---|---|---|---|---|
| web-cfg | main@89b081a8676d8a0b30747dfcb1477f21d9ac4dfb | DONE | n/a | none | none | Treat as contemporaneous web-cfg tip | Do not treat prompt SHAs as current | gh api repos/tjsasakifln/web-cfg/commits/main; merge of #586 2026-09-04T19:21:26Z | 2026-09-04T23:38:42Z |
| extra-cli | main@3919f4d9af1363e2db641c7edadb8a8404874ec4 | DONE | n/a | none | none | Treat as contemporaneous extra-cli tip | Do not treat #543 as still open | gh api repos/tjsasakifln/extra-cli/commits/main; merge of #543 2026-09-04T21:33:47Z | 2026-09-04T23:38:42Z |
| warmbly | main@8602ce4ae68e27080fa4431390194c09c2b76d06 | DONE | n/a | none | none | Treat as contemporaneous warmbly tip | Do not mutate production dispatch | gh api repos/tjsasakifln/warmbly/commits/main; 0 open PRs | 2026-09-04T23:38:42Z |
| Governance | main@230d73a22a321112abe09b34a0d5fe743790b857 | DONE | n/a | none | none | Treat as contemporaneous Governance tip and this snapshot BASE_SHA | Do not update local main | git rev-parse origin/main in campaign worktree | 2026-09-04T23:38:42Z |
| meetcfg | main@26f79e3fd414b12e765b6ec243e47a90c8a9b226 | DONE | n/a | none | none | Treat as contemporaneous meetcfg tip | Do not reconstruct commercial truth in Meetcfg | gh api repos/tjsasakifln/meetcfg/commits/main; 0 open PRs | 2026-09-04T23:38:42Z |
| lead-recovery | repo-open-work=0 | DONE | none | none | none | Confirm no-open-work; leave dormant | Do not reactivate lead-recovery | gh: 0 open PRs, 0 open issues; last push 2026-06-27 | 2026-09-04T23:38:42Z |
| Inbound | repo-open-work=0 | DONE | none | none | none | Confirm no-open-work; leave dormant | Do not reactivate Inbound | gh: 0 open PRs, 0 open issues; last push 2025-07-11 | 2026-09-04T23:38:42Z |
| outreach | repo-open-work=0 | DONE | none | none | none | Confirm no-open-work; leave dormant | Do not reactivate outreach | gh: 0 open PRs, 0 open issues; last push 2026-07-02 | 2026-09-04T23:38:42Z |
| web-cfg | PR#522 | NOW | 01 | DAG before #544 | none on mergeability | Campaign 01 may rebase/merge Dependabot puppeteer-core after reviewing site-ci | Do not comment/close from campaign 16; do not merge from this snapshot | open MERGEABLE; site-ci SUCCESS; pSEO SUCCESS; observed open PR count=8 | 2026-09-04T23:38:42Z |
| web-cfg | PR#523 | NOW | 01 | DAG before #544 | none on mergeability | Campaign 01 may rebase/merge Dependabot terser | Do not comment/close from campaign 16 | open MERGEABLE; site-ci SUCCESS; pSEO SUCCESS | 2026-09-04T23:38:42Z |
| web-cfg | PR#524 | HOLD | 01 | DAG before #544 | site-ci FAILURE; pSEO quality gates FAILURE | Campaign 01 must repair required checks before merge | Do not waive site-ci; do not comment from campaign 16 | open MERGEABLE but required checks red | 2026-09-04T23:38:42Z |
| web-cfg | PR#544 | NOW | 01 | DAG after #522/#523/#524 | serial DAG not yet landed | Campaign 01 integrates after dependency PRs; capture full-page before screenshot | Do not comment/close from campaign 16 | open MERGEABLE; site-ci SUCCESS | 2026-09-04T23:38:42Z |
| web-cfg | PR#536 | HOLD | 01 | DAG after #544; issues #442/#443/#410 | CONFLICTING vs main@89b081a; site-ci FAILURE on home LCP >2000ms | Keep LCP HOLD; rebase is campaign 01; #586 absorbed subset only | Do not merge while LCP HOLD; do not claim #586 closed #536 | PR body states HOLD; site-ci FAILURE; mergeable CONFLICTING | 2026-09-04T23:38:42Z |
| web-cfg | PR#548 | HOLD | 01 | DAG after #536; issue #528 | CONFLICTING vs main | Campaign 01 rebase after DAG predecessors | Do not comment/close from campaign 16 | open CONFLICTING; site-ci SUCCESS on stale head | 2026-09-04T23:38:42Z |
| web-cfg | PR#549 | HOLD | 01 | DAG after #548; issue #532 | CONFLICTING vs main | Campaign 01 rebase after DAG predecessors | Do not comment/close from campaign 16 | open CONFLICTING; site-ci SUCCESS on stale head | 2026-09-04T23:38:42Z |
| web-cfg | PR#535 | HOLD | 01 | DAG after #549; issue #518 | CONFLICTING vs main | Campaign 01 rebase after DAG predecessors | Do not comment/close from campaign 16 | open CONFLICTING; site-ci SUCCESS on stale head | 2026-09-04T23:38:42Z |
| web-cfg | PR#586 | PARTIAL | 01 | subset of #536 runtime (#442/#443/#410) | #536 LCP HOLD remains | Record as merged subset; leave #536 HOLD | Do not treat #586 as LCP clearance or as merge of #536 | MERGED 89b081a at 2026-09-04T19:21:26Z; PR text: does not merge #536 (LCP HOLD) | 2026-09-04T23:38:42Z |
| extra-cli | issue#530 | PARTIAL | extra-cli producer / campaign 07 consumer | PR#539 DONE; web-cfg#563 ACK PASS; warmbly#260 official ACK PENDING | official extra-cli envelope not yet at Warmbly border; extra-cli#468 outbound freeze | Keep OPEN until Warmbly official envelope ACK on same schema/source_run_id/hash/as_of | Do not close because #539 merged; do not treat canary as official envelope; no SMTP | OPEN; body still says #539 remains open (STALE); comments 2026-09-04 record #539 merged f943214a and Warmbly ACK PENDING | 2026-09-04T23:38:42Z |
| extra-cli | PR#539 | DONE | extra-cli | extra-cli#530 remaining consumer proof | none for this PR | Do not reopen as if still in-flight | Do not describe as open in new work | MERGED f943214a at 2026-09-04T00:50:44Z | 2026-09-04T23:38:42Z |
| extra-cli | PR#543 | DONE | extra-cli commercial-plane | Governance#1 remains residual ADR of roles/catalog/Asaas | none for this PR | Confront Governance#1: complementary, not a close | Do not close Governance#1 because #543 merged; no SMTP; no source run | MERGED 3919f4d9 at 2026-09-04T21:33:47Z; ADR-039 Accepted/Effective in extra-cli | 2026-09-04T23:38:42Z |
| extra-cli | PR#531 | LATER | extra-cli independent | none for this wave | Test All (full suite) FAILURE; independent of inbound wave | Leave as independent LATER; not site-migration | Do not treat as web-cfg site migration; do not pull into campaigns 01-15 | open MERGEABLE; title CONTRACT_LIFECYCLE_TRUTH; prompt 'site migration' is stale | 2026-09-04T23:38:42Z |
| extra-cli | issue#468 | HOLD | extra-cli incident | PR#529 deploy checkpoint; founder release | state:blocked; outbound population freeze | Keep fail-closed until four exit criteria; refresh is Data Lake cycle not PNCP live | Do not authorize SMTP; do not resume aborted 2026-09-04 commercial campaign | OPEN P0 state:blocked; body forbids SMTP | 2026-09-04T23:38:42Z |
| extra-cli | issue#469 | HOLD | extra-cli | extra-cli#468 checkpoint | state:blocked | Wait #468 exit before contact-discovery yield | Do not implement population change from #542 | OPEN P1 state:blocked | 2026-09-04T23:38:42Z |
| extra-cli | issue#542 | DECISION_ONLY | extra-cli | COMMERCIAL_AUTHORITY/2.0 | human decision; do not implement in this wave | Leave as decision record | Do not implement population change | OPEN title: mudança de população (não implementar) | 2026-09-04T23:38:42Z |
| warmbly | issue#260 | PARTIAL | 07 | extra-cli#530/#539 producer; Governance#65; Warmbly#47 closed | official extra-cli envelope missing at border (canary only) | Consume official envelope once; prove inbox→watch→queue; 100-replay dedup | Do not treat canary as official; no SMTP; body still stale on #539 open | OPEN; comment 5541041876 ACK canary only; SMTP_SENT=NO | 2026-09-04T23:38:42Z |
| warmbly | issue#43 | HOLD | warmbly outbound | warmbly#204 safety; CFG-FIRST-TOUCH-ROUTING-v3 does not authorize dispatch | NO_GO_SMTP; no human GO_FOR_CONTROLLED_EMAIL_PILOT | Re-evaluate GO/NO-GO only; keep dispatch paused | Do not authorize SMTP from this wave; do not reduce/replace outbound motor | OPEN P0; body CURRENT STATE NO_GO_SMTP | 2026-09-04T23:38:42Z |
| warmbly | issue#155 | NOW | warmbly first-touch readiness | policy v3 pin; Governance#127 readback; #204 safety | SMTP not authorized; proof stops at QUEUED | Keep delegated path to QUEUED with dispatch paused | Do not treat QUEUED as SMTP; no provider mutation | OPEN P1; body: readiness até QUEUED, sem SMTP | 2026-09-04T23:38:42Z |
| warmbly | issue#117 | NOW | warmbly incident controls | none authorizing transport | none for classification | Keep API-actor vs kill-switch distinction | Do not use incident controls to authorize SMTP | OPEN P1 roadmap:now | 2026-09-04T23:38:42Z |
| warmbly | issue#47 | DONE | 07 residual moved | Governance#65; web-cfg#61 | closed; residual live proof on #260 | Do not reopen; point consumers at #260/#65 | Do not cite as open NOW owner without the closed_at evidence | CLOSED completed 2026-09-04T03:09:45Z | 2026-09-04T23:38:42Z |
| Governance | issue#1 | PARTIAL | Governance ADR / campaign 06 adjacent | extra-cli#543 DONE commercial-plane; Warmbly#155/#43 transport; #129 transport authorization | Asaas mapping/checkout/real-money still not proven; extra-cli#543 does not satisfy #1 DoD | Keep OPEN; comment contemporaneous confrontation with extra-cli#543 | Do not close because #543 merged; comments do not change authority; no SMTP | OPEN reopened; last comment 2026-09-04T13:02:13Z predates #543 merge 21:33Z | 2026-09-04T23:38:42Z |
| Governance | issue#65 | NOW | 06 | web-cfg#61; extra-cli#530; warmbly queue; meetcfg#1 | E2E net-new to queue not terminal | Campaign 06 owns admission policy; shipped v1 on main is not this snapshot | Do not implement policy/schema in campaign 16; do not close because PR#166 merged | OPEN P0 reopened; PRs #91 and #166 merged; acceptance remains E2E | 2026-09-04T23:38:42Z |
| Governance | issue#127 | NOW | Governance control-center | warmbly#155 QUEUED readback | pilot proof | Leave to Control Center owner | Do not treat as SMTP GO | OPEN P1 roadmap:now | 2026-09-04T23:38:42Z |
| Governance | issue#120 | LATER | Governance commercial E2E | Asaas/delivery | not this wave | Leave NEXT | Do not open new epic | OPEN P1 roadmap:next | 2026-09-04T23:38:42Z |
| web-cfg | issue#61 | NOW | web-cfg inbound epic | extra-cli#539 DONE; extra-cli#530 PARTIAL; Governance#65; Warmbly#47 CLOSED | body CURRENT NOW ORDER still lists PR#539 as open first step (STALE) | Keep epic OPEN; comment contemporaneous order; do not create a new epic | Do not close because #539/#563 merged; do not authorize SMTP | OPEN P1 strategic-parent; 4 sub-issues 75% complete; body still says PR#539 remains open | 2026-09-04T23:38:42Z |
| web-cfg | issue#577 | NOW | 02 parent epic | children #578-#588 | multi-vertical journey not yet proven | Keep as strategic parent; no new epic | Do not close from campaign 16; do not absorb child acceptance | OPEN P0 decision:strategic-parent created 2026-09-04T17:31:54Z | 2026-09-04T23:38:42Z |
| web-cfg | issue#578 | NOW | 02 | #577 | none classified external | Architecture/taxonomy campaign | Do not edit shared README from campaign 16 | OPEN P0 | 2026-09-04T23:38:42Z |
| web-cfg | issue#580 | NOW | 08 | #577; Governance#65 | none classified external | Capture/handoff campaign | Do not leak sensitive data; no first-contact upload | OPEN P0 | 2026-09-04T23:38:42Z |
| web-cfg | issue#581 | NOW | 04 | #577; #243 | founder-sourced credentials only | Credentials campaign | Do not invent CREA/proof | OPEN P0 | 2026-09-04T23:38:42Z |
| web-cfg | issue#582 | NOW | 10 | #577 | none classified external | Home/navigation/CSS campaign | Do not touch global CSS from campaign 16 | OPEN P0 | 2026-09-04T23:38:42Z |
| web-cfg | issue#583 | NOW | 03 | #577 | none classified external | Offer catalog campaign | Do not replace Governance catalog.v1 as second authority | OPEN P1 | 2026-09-04T23:38:42Z |
| web-cfg | issue#585 | NOW | 05 | #577 | none classified external | Conflict-ethics campaign | Do not weaken conflict gate | OPEN P0 | 2026-09-04T23:38:42Z |
| web-cfg | issue#587 | NOW | 03 | #577; #583 | none classified external | B2G offer productization | Do not promise administrative decision | OPEN P1 | 2026-09-04T23:38:42Z |
| web-cfg | issue#588 | LATER | 03 | #587; #577; #580 | must not divert campaign 09 private canary | Keep listed; execute only after private canary priority is preserved | Do not steal private_project_technical_readiness priority; do not close from campaign 16 | OPEN P1 decision:execute-now; classified LATER vs private canary 09 | 2026-09-04T23:38:42Z |
| web-cfg | issue#579 | NOW | 11 | #577 | none classified external | Local hub campaign | No doorway pages | OPEN P1 | 2026-09-04T23:38:42Z |
| web-cfg | issue#531 | LATER | 12 | none | decision:later | Proof QA later | Do not invent case studies | OPEN P2 decision:later | 2026-09-04T23:38:42Z |
| web-cfg | issue#529 | HOLD | 13 | INDEX_READY URLs + real traffic | decision:measurement-wait | Wait indexable URLs | Do not treat page count as success | OPEN P2 | 2026-09-04T23:38:42Z |
| web-cfg | issue#563 | DONE | web-cfg pSEO consumer | extra-cli#530 remains PARTIAL for producer | closed; extra-cli#530 still open | Do not reopen; extra-cli#530 cannot be closed by this consumer | Do not treat producer#530 as closed | CLOSED completed 2026-09-04T16:06:12Z | 2026-09-04T23:38:42Z |
| web-cfg | issue#442 | PARTIAL | 01 runtime | PR#586 merged subset; PR#536 HOLD | live cutover remaining; LCP HOLD on #536 | Host install remaining after promote | Do not close because #586 merged | OPEN P1; #586 merged, #536 still HOLD | 2026-09-04T23:38:42Z |
| web-cfg | issue#443 | PARTIAL | 01 runtime | PR#586; PR#536 | timer disabled until separate authorization | Do not enable retention timer in this wave | No systemctl from campaign 16 | OPEN P1 | 2026-09-04T23:38:42Z |
| web-cfg | issue#410 | PARTIAL | 01 runtime | PR#586; PR#536 | live CSP canary after cutover | Keep /ops/ no-transform | Do not widen CSP | OPEN P1 | 2026-09-04T23:38:42Z |
| meetcfg | issue#1 | NOW | 14 | Governance#65; Warmbly accepted hand-raiser | Warmbly#47 closed; context contract still needed | Campaign 14 consumer envelope; fail closed on schema drift | Do not create leads/CRM/outbound eligibility in Meetcfg | OPEN P1 reopened; PR#2 merged does not close acceptance | 2026-09-04T23:38:42Z |
| meetcfg | issue#3 | LATER | 14 | meetcfg#1 | handoff first | Stage guidance after context envelope | Do not store raw transcripts | OPEN P1 | 2026-09-04T23:38:42Z |
| meetcfg | issue#4 | LATER | 14 | meetcfg#1 | handoff first | Briefing after context envelope | Do not invent commercial facts | OPEN P1 | 2026-09-04T23:38:42Z |
| meetcfg | issue#5 | LATER | 14 | meetcfg#1 | handoff first | Next-step tracking after context | Do not auto-send | OPEN P1 | 2026-09-04T23:38:42Z |
| meetcfg | issue#6 | LATER | 14 | meetcfg#1 | handoff first | Export outcome to commercial authority | Do not become second commercial SoT | OPEN P1 | 2026-09-04T23:38:42Z |
| meetcfg | issue#7 | LATER | 14 | meetcfg#1 | handoff first | Adversarial review of suggested speech | Do not display unreviewed drafts as usable | OPEN P1 | 2026-09-04T23:38:42Z |
| Governance | campaign-15-premortem | NOW | 15 | this snapshot as input | none | Premortem uses photograph; does not edit snapshot | Do not share this worktree | sibling worktree audit/campaign-20260904-multivertical-premortem-v3 on same origin/main SHA | 2026-09-04T23:38:42Z |
| Governance | goal-97-integration | LATER | 97 | this snapshot + sibling campaign PRs | must refresh ledger before integration | Refresh protocol then integrate shared registries/CI | Do not merge wave PRs from campaign 16 | refresh-protocol.md; file-locks shared_registry_owner=97 | 2026-09-04T23:38:42Z |
| Governance | goal-98-audit | LATER | 98 | 97 | none yet | Final audit after integration | Do not promote | owner matrix | 2026-09-04T23:38:42Z |
| Governance | goal-99-promotion | LATER | 99 | 98 | human promotion only | Promotion after audit | NO_DEPLOY from campaign 16 | owner matrix | 2026-09-04T23:38:42Z |
| Governance | campaign-09-private-canary | NOW | 09 | private_project_technical_readiness_v1 | no product issue to be created by campaign 16 | Keep private canary priority above #588 | Do not create a product issue for canary 09; do not implement policy/schema | contract-dag private asset ids; #588 classified LATER vs this owner | 2026-09-04T23:38:42Z |
| Governance | campaign-16-control-snapshot | NOW | 16 | GitHub oracle | none for photograph | Publish docs-only PR; do not merge | No product code; no SMTP; no deploy | this pack; WRITE_SET limited to control-snapshot + test + fragments | 2026-09-04T23:38:42Z |

## Named reconciliation nodes (summary)

| node | contemporaneous state |
|---|---|
| web-cfg eight open PRs DAG #535/#536/#544/#548/#549 + Dependabot #522–#524 | confirmed still eight open at observed_at |
| #586 vs #536 LCP HOLD | #586 PARTIAL merged; #536 HOLD remains |
| extra-cli #530 vs integrated #539 | #539 DONE; #530 PARTIAL |
| Warmbly #260 vs extra-cli #530/#539 | PARTIAL; official envelope ACK pending |
| Governance #1 vs extra-cli #543 | #543 DONE; #1 PARTIAL not superseded |
| web-cfg #61 NOW vs #539 | #61 NOW; NOW-order step citing open #539 is stale |
| extra-cli #531 independent/LATER | LATER CONTRACT_LIFECYCLE_TRUTH; not site migration |
| #588 vs private priority | LATER vs campaign 09 |
| outbound #43/#155 | HOLD/NOW; SMTP not authorized |

NO_MERGE=CONFIRMED · NO_DEPLOY=CONFIRMED · NO_SMTP=CONFIRMED
