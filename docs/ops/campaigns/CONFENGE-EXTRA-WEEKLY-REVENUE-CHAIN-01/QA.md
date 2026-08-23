# QA evidence

Evidence date: 2026-08-22. All executions were local, synthetic, and network-free except GitHub PR metadata operations.

| Layer | Command | Result |
| --- | --- | --- |
| Warmbly adapter unit/replay/restart/restore | `python3 -m unittest discover -s deploy/confenge-vps/asaas-adapter -p 'test_*.py' -v` | 7 passed |
| Warmbly deployment pack | `python3 -m unittest deploy/confenge-vps/test_vps_pack.py -v` | 9 passed |
| Warmbly commercial unit/contract/integration | `go test ./internal/app/confenge/...` | Passed |
| Warmbly lint | `make lint` | Passed |
| Warmbly docs types | `pnpm types:check` | Passed |
| Warmbly docs lint | `pnpm lint` | 0 errors, 2 pre-existing warnings |
| Control Center contracts | contracts typecheck and test | 116 passed |
| Warmbly connector | connector typecheck and test | 93 passed |
| Control Center collector/projector | collector typecheck and test | 67 passed |
| Control Center web shell | web-shell typecheck and full test | 225 passed, including 2 weekly-chain tests |

## Covered failure cases

- invalid webhook authentication;
- persist before acknowledgement;
- duplicate provider event;
- received event before commercial snapshot;
- retry of a durable unprocessed receipt after the snapshot arrives;
- partial semantic failure and exhausted retry;
- process restart with expired lease;
- backup and restore with schema/integrity checks;
- immutable terms drift;
- `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`, and `PAYMENT_RECEIVED` without a hosted checkout but with a stable provider charge;
- receipt absence rendered as `UNKNOWN`, not zero;
- unsafe free-form canonical identity dropped/rejected.

No real smoke was run because the task explicitly prohibits real charge creation, client contact, and PII transmission.
