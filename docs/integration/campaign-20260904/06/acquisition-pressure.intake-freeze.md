# Integration fragment — campaign 06 — acquisition-pressure intake freeze

- target_path: `commercial/acquisition/acquisition-pressure.v1.json`
- operation: none in this campaign; freeze remains `NET_NEW_INBOUND_HANDRAISER-v1`
- stable_key: `intake_frozen`
- dependency: campaign 16 may update the issue ledger; it must not alter this admission policy
- test: `intake_frozen == NET_NEW_INBOUND_HANDRAISER-v1`; `intake_schema_change` remains forbidden
- rollback: leave the freeze on v1

Campaign 06 publishes a new inbound version beside v1. Goal 97 decides whether
the freeze should name the draft version.
