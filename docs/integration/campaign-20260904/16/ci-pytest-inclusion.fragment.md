# Fragment: include control-snapshot pytest in commercial-authority CI

- `target_path`: `.github/workflows/commercial-authority.yml`
- `operation`: append `tests/test_control_snapshot_campaign_20260904.py` to the existing `python -m pytest …` invocation in job `validate` / step `Adversarial tests`
- `stable_key`: `tests/test_control_snapshot_campaign_20260904.py`
- `dependency`: CAMPAIGN_ID=16 snapshot pack under `docs/campaigns/2026-09-04-multivertical/control-snapshot/` must already be on the branch being integrated; local pytest on that HEAD is the campaign 16 gate
- `teste`: from repo root, `python -m pytest tests/test_control_snapshot_campaign_20260904.py -q` twice; both runs pass with identical assertion outcomes. Then re-run the commercial-authority pytest list **plus** this module. Do not treat absence from CI as a campaign 16 failure
- `rollback`: remove the path from the pytest list; leave the snapshot files and the test module in place or revert the campaign 16 PR as a unit
- `do_not`: campaign 16 must not edit `.github/**` itself; goal 97 applies or rejects this fragment after refreshing the ledger

`observed_at` of the requesting photograph: `2026-09-04T23:38:42Z`.
