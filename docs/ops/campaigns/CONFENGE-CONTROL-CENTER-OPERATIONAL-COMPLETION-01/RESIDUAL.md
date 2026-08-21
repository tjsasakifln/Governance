# RESIDUALS

## CREDENTIAL_GATE (does not block code merge; blocks WARMBLY_LIVE_READ until activation)

- Production collector currently has GitHub only (`GITHUB_REPOS=tjsasakifln/Governance`). Warmbly/PNCP/infra/Asaas secrets are not yet injected. Activation is the post-merge step of this campaign.
- Warmbly can mint a read-only API key (`READ_CONTACTS|READ_CRM|READ_CAMPAIGNS|READ_UNIBOX`) without `SEND_CAMPAIGNS`. No keys existed at inspection time; the collector must not reuse a human password or `INTERNAL_API_TOKEN`.
- Asaas remains `BLOCKED_BY_SECRET` if no read credential exists. Does not block Operational V1.
- `GITHUB_REPOS` must be expanded to Governance, warmbly, extra-cli, web-cfg at activation.

## FOUNDER_AUTHORITY_GATE

- `real_money_mutation_approved=false`.
- Warmbly `CONFENGE_AUTO_SEND_ENABLED=false` and `CONFENGE_GREEN_AUTORUN_ENABLED=false` on the live backend. This campaign does not enable them.
- Operator actions persist as Control Center audit records only. Mapping them onto Warmbly `POST /confenge/intel/exceptions/:id/resolve` is an explicit later founder decision.

## EXTERNAL_SERVICE_GATE

- Warmbly PR #104 **is merged**. Production Warmbly SHA is `13e7a082b7614ada39f994989e23398d85595400` (intel contracts present). Current Warmbly main is `c8128f1e9baf8f67d97021530c7d0cbcbc707612` (PR #105 compose SHA env only); not required for Control Center intel reads.
- extra-cli PR #447 merged; main = deployed = `a58781da9846deed1a65856914e593b3621a9646`. READY_FOR_CONTROLLED_EMAIL_COHORT_INPUT, not a send authorization. No real email sent.
- GSC/GA4 search-visibility hops stay BLOCKED without durable ingest.

## NOT DONE ON PURPOSE

- No competing Control Center PR. No force-push. PR #8 untouched (`6dfa10420a03412e1ce60fe38729298cd4ae22d1`, still open).
- Client 360 is not a full Warmbly+Governance+Asaas identity join.
- No intranet/web-cfg redo. No DNS change.
