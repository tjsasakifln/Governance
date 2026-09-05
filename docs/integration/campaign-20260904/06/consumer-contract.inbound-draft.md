# Integration fragment — campaign 06 — CONSUMER-CONTRACT inbound pin

- target_path: `commercial/CONSUMER-CONTRACT.md`
- operation: append a section for `NET_NEW_INBOUND_HANDRAISER/1.0.0-draft.20260904` without deleting the v1 section
- stable_key: `inbound_admission_net_new_handraiser`
- dependency: campaign 06 policy published; goal 97 chooses dual-active vs supersede
- test: consumers pin `canonical_name` + `policy_hash`; unknown version fail-closed; v1 string does not activate this version
- rollback: keep the v1 pin; this version remains exact-match only

Do not edit `commercial/CONSUMER-CONTRACT.md` in campaign 06. v1 text currently
says it is the only active inbound policy; that remains true for v1 pins until
goal 97 ratifies.
