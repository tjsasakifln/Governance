# Fragment: index the control-tower snapshot from shared docs

- `target_path`: shared docs README/index (no such index was present on `origin/main` `230d73a22a321112abe09b34a0d5fe743790b857`; do not invent one inside campaign 16)
- `operation`: add a single link to `docs/campaigns/2026-09-04-multivertical/control-snapshot/ledger.md` labelled as the 2026-09-04 multivertical control-tower photograph (CAMPAIGN_ID=16)
- `stable_key`: `docs/campaigns/2026-09-04-multivertical/control-snapshot/`
- `dependency`: eight snapshot files exist; goal 97 refreshes `observed_at` before treating counts as current
- `teste`: the linked path exists; `ledger.md` still contains the ten required column names
- `rollback`: remove the index link; do not delete the snapshot pack from this fragment
- `do_not`: campaign 16 must not edit `README.md` or `docs/README.md`

`observed_at` of the requesting photograph: `2026-09-04T23:38:42Z`.
