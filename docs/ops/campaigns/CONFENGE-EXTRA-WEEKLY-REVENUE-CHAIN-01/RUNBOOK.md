# Sandbox runbook

This runbook is dry-run/sandbox only. Do not contact the account, send commercial messages, create an Asaas charge, use a production token, or transmit PII.

## Ordered delivery

1. Warmbly #132: versioned persist-first Asaas edge adapter and deploy recovery.
2. Warmbly #133: canonical identity, immutable terms regression, unprocessed-receipt retry, weekly executive contract.
3. Governance #89: Control Center contract and safe projector.
4. Governance UI/documentation PR stacked on #89.

## Preconditions

- Use only the opaque sandbox IDs in `internal/app/confenge/intel/testdata/extra_weekly_revenue_chain.json`.
- Keep `CONFENGE_PROVIDER_MODE=sandbox` and adapter dry-run enabled.
- Use a local stub for the Warmbly semantic target. Never point the test adapter at production.
- Verify no payload contains email, phone, CPF, CNPJ, contact name, bearer token, or `asaas-access-token`.

## Software smoke

From the Warmbly worktree:

```bash
go test ./internal/app/confenge/intel -run 'TestExtraWeekly|TestProviderReceipt|TestTermsSnapshot' -count=1 -v
python3 -m unittest discover -s deploy/confenge-vps/asaas-adapter -p 'test_*.py' -v
```

The first command must prove one chain named `corr:corr_extra_sbx_week_2026_34`. Before the last fixture event, `receipt.availability` must be `UNKNOWN` and `amount_cents` must be absent. After `payment_received`, the same correlation must expose `payment_asaas_sbx_001` and 800000 observed cents.

From Governance `control-center/`:

```bash
npm run test --workspace=@confenge/control-center-contracts
npm run test --workspace=@confenge/control-center-collector
npm run test --workspace=@confenge/control-center-web-shell -- --test-name-pattern='weekly'
```

The rendered row must show the same correlation and the human gate `WAIT`.

## Deployment rehearsal

Use a disposable sandbox host and the versioned scripts from Warmbly #132. Check file ownership and modes before starting the unit. The adapter database directory must be `0700`, and database, backup, and secret files must be `0600`.

Rehearse backup and restore against a copied sandbox database. The restore command must reject a database with a wrong schema version or failed SQLite integrity check. Never restore over the only copy.

## Rollback

1. Stop only the sandbox adapter unit.
2. Restore the previous Nginx include and systemd unit from the deployment backup.
3. Apply `000115_outreach_intel_canonical_identity.down.sql` only after confirming no later migration depends on the identity-link table.
4. Revert the Control Center read-model PR. No origin-system financial data is mutated by this rollback.

## Provider behavior references

- Asaas webhook authentication: <https://docs.asaas.com/docs/webhooks-faq>
- Webhook creation and token header: <https://docs.asaas.com/docs/create-new-webhook-via-api>
- Retry and retention logs: <https://docs.asaas.com/docs/webhooks-logs>
- Event idempotence: <https://docs.asaas.com/docs/how-to-implement-idempotence-in-webhooks>

## Incident rule

Do not mark the event processed merely because the HTTP response is 2xx. Processed means the semantic Warmbly response confirms the event was durably applied. Authentication failure, storage failure, contract hold, exhausted retry, stale backup, and restore failure must remain actionable occurrences with owner and next action.
