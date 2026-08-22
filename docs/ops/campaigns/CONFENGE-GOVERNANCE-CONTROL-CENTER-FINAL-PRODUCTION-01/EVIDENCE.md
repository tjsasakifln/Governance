# EVIDENCE — CONFENGE-GOVERNANCE-CONTROL-CENTER-FINAL-PRODUCTION-01

Canonical companion: `control-center/releases/2026-08-22-production-current-observing.md`.

**FINAL_VERDICT=CONTROL_CENTER_PRODUCTION_CURRENT_AND_OBSERVING**

## Baseline

Fetched `origin/main` = `e1f9b6920adb080672da4fc68c92f633e1e8322e` (PR #46). VPS checkout and collector image already matched. No aesthetic redeploy. PR #8 untouched (open). Warmbly not restarted.

## Tests

Runner 32, Warmbly connector 27, web-shell 76, context 50, persistence 32, contracts 99, commercial read-model 23, deploy/backup 20 — all pass on `e1f9b69`. Image-scan skipped (no rebuild). Playwright local blocked by missing `libnspr4`; UI unchanged.

## Live collector

Run `cc:collector-run:01M0KJH82KGT6TG319BJ16HDCT` DONE/FRESH. Commercial snapshot `cc:operational-snapshot:01M0KJH83XKGZVEFJ2SEGAHHCV` persisted (338827 bytes). Clients snapshot persisted (`client_360=partial_warmbly_only`). `_persist_truncation` absent. `exceptions_total=362`, `exceptions_shown=50`, `exceptions_capped=true`. Optional `/v1/campaigns` 500 did not flip required CRM off FRESH. Historical four `persist_partial` rows are pre-#45 only.

## Surfaces / no transport authority

`/v1/domains/commercial` 200 twice. Cockpit: visão, coortes (`#/comercial/cohorts`), atividade, pipeline, exceções, crescimento. `SEND_EMAIL` HTTP 403. Auto-send observed false. No Warmbly send/resolve/authorize POSTs.

## First cohort

Warmbly `pilot_cohort_state=ready`, prepared=10, sent=0, `dispatch_attempted=false`. No events invented. Observation ready.

## Gaps

Client 360 not complete. GSC/GA4/Asaas not declared proven. Cohort not dispatched. Optional campaigns GET still 500.
