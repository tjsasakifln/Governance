# Before and after matrix

| Capability | Before | After ordered PRs | Authority |
| --- | --- | --- | --- |
| Canonical identity | Transport and idempotency IDs could split one commercial path | Opaque account, opportunity, offer, proposal, charge, and payment IDs share one `correlation_id` | Warmbly |
| Names as keys | Not explicitly prohibited by the weekly contract | Schema and projector reject whitespace/free-form canonical keys | Warmbly + Control Center contract |
| Missing receipt | Could be visually confused with numeric absence in generic summaries | Exact `{ "availability": "UNKNOWN" }`; zero is forbidden on an unknown fact | Warmbly + Control Center |
| Terms | Snapshot existed; drift comparison could miss a changed input | First snapshot is retained and `terms_drift` becomes actionable | Warmbly |
| Inbound webhook | No tracked edge adapter; held 2xx semantics were unsafe | Authenticated, persist-first, PII-minimized, semantic acknowledgement | Warmbly edge |
| Duplicate and out-of-order | Unprocessed duplicates could fail to retry | Duplicate after completion is idempotent; held receipt retries after prerequisites | Warmbly |
| Partial failure | No adapter-owned retry/dead state | Bounded retry with actionable blocked/dead occurrence | Warmbly edge |
| Restart | No versioned lease recovery | Expired processing lease returns to retry | Warmbly edge |
| Restore | No adapter restore drill | Online SQLite backup plus schema/integrity restore verification | Warmbly edge |
| Control Center | Executive payload existed but no complete weekly row was rendered | The operator sees localized state, deadline, action, charge, receipt, source period, collection instant, and authority; opaque IDs and raw tokens stay in a technical disclosure | Governance operates/visualizes |
| Financial truth | Risk of treating object creation as cash | Charge remains distinct from received payment; Asaas is labeled authority | Asaas |
| Commercial decision | Could be absent in the visual chain | `GO`, `NO-GO`, or `WAIT`; sandbox fixture remains `WAIT` | Human |
