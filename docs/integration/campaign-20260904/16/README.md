# Campaign 16 integration fragments

Owner: CAMPAIGN_ID=16 (control-tower snapshot). Integration owner: goal **97**.

These fragments exist because campaign 16 must not edit shared README/index, `.github/**`, lockfiles, or `package.json`. They are not production authority.

| file | target_path | operation | stable_key |
|---|---|---|---|
| `ci-pytest-inclusion.fragment.md` | `.github/workflows/commercial-authority.yml` | add pytest path | `tests/test_control_snapshot_campaign_20260904.py` |
| `docs-index.fragment.md` | shared docs README/index (when one exists) | link snapshot pack | `docs/campaigns/2026-09-04-multivertical/control-snapshot/` |

Refresh the control-tower ledger before applying these fragments. `outbound_eligible=false`. `auto_send=false`. `NO_MERGE` / `NO_DEPLOY` / `NO_SMTP`.
