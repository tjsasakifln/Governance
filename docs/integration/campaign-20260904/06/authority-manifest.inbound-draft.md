# Integration fragment — campaign 06 — authority-manifest inbound draft

- target_path: `commercial/authority/authority-manifest.v1.json`
- operation: optional later listing of `NET_NEW_INBOUND_HANDRAISER/1.0.0-draft.20260904` as a distinct inbound authority
- stable_key: `net_new_inbound_handraiser`
- dependency: goal 97; do not silently replace the v1 entry
- test: exact version match; missing/unknown fail closed
- rollback: manifest continues to omit this draft until ratified
