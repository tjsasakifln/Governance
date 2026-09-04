# Integration fragment — campaign 06 — CONSUMER-HANDOFF inbound pin

- target_path: `commercial/CONSUMER-HANDOFF.md`
- operation: add pin instructions for `NET_NEW_INBOUND_HANDRAISER/1.0.0-draft.20260904` and the inbound consumer pin file
- stable_key: `inbound_admission_consumer_handoff`
- dependency: `commercial/inbound/CONSUMER-PIN.1.0.0-draft.20260904.md`
- test: pin command `python -c "from commercial.inbound import load_draft_authority, policy_hash; print(policy_hash(load_draft_authority()))"`
- rollback: consumers keep the v1 pin command

Do not copy the schema. Do not treat extra-cli PNCP live as this inbound source.
