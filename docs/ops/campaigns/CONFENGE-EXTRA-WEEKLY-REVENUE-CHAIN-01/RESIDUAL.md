# Explicit residuals

1. **Human commercial gate:** `WAIT`. A human must decide `GO` or `NO-GO`; software must not infer it.
2. **Real financial observation:** no non-synthetic Asaas event was consumed. Production revenue is therefore not marked done.
3. **Real canary for Warmbly #129:** backlog, dead occurrence, and backup freshness are implemented, but a consented real canary remains pending.
4. **Deployment:** PRs must merge in order, migration `000115` must be applied, and the adapter unit/Nginx include must be installed on the target host.
5. **Credential rotation:** a real `asaas-access-token` must be provisioned out of band. It must never enter git, logs, fixtures, or Control Center.
6. **Retention policy approval:** the adapter defaults must be reviewed against operational/legal policy before production retention is enabled.
7. **Production restore drill:** only the sandbox restore was exercised. A scheduled production-safe restore drill remains operational work.
8. **Warmbly #47 broader scope:** first real controlled email learning and its commercial conclusion remain separate from this revenue-chain implementation.

The software path is sandbox-reconciled, not production-DONE.
