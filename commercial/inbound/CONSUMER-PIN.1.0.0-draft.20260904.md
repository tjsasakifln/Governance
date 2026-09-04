# Consumer pin — `NET_NEW_INBOUND_HANDRAISER/1.0.0-draft.20260904`

Governance is the only admission authority for this version. Pin the
canonical name and the content hash. Do not copy the schema into web-cfg,
Warmbly, Meetcfg or extra-cli as a second authority.

## Pin

```
canonical_name = NET_NEW_INBOUND_HANDRAISER/1.0.0-draft.20260904
policy_hash    = python -c "from commercial.inbound import load_draft_authority, policy_hash; print(policy_hash(load_draft_authority()))"
```

`NET_NEW_INBOUND_HANDRAISER-v1` remains an exact-match authority for existing
Warmbly pins. A v1 string does not activate this version. Missing, old or
unknown version fail closed.

## Owner planes

| Plane | Owner | Receives |
|---|---|---|
| Policy / admit rules | Governance | — |
| `CONFENGE_WEB` production | web-cfg | submits intake |
| Persist / act / queue | Warmbly | every closed decision |
| Accepted context only | Meetcfg | `ACCEPTED` only |

extra-cli `#543` PNCP live is ingestion/telemetry. It is not commercial
authority and is not this inbound admission.

## Construction

- Net-new is inbound-only. `outbound_eligible=false`, `auto_send=false`.
- Absence of a prior account is not a discard.
- Live Intelligence / first-touch / outbound payloads are rejected.
- Conflict `UNKNOWN` never becomes `CLEAR`.
- Sensitive class/ref only; no sensitive content in the public envelope.
- HTTP 2xx is not acceptance; require receipt/readback.
- Replay is exactly-once logical.

## Coordination IDs

Taxonomy, catalog, web-intake, handraiser-state and Meetcfg context IDs in
fixtures are test-only. Goal 97 ratifies them. They are not runtime fallbacks.
Divergent or missing version/hash fail closed.
