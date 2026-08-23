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
| Control Center contracts | contracts typecheck and test | 118 passed |
| Warmbly connector | connector typecheck and test | 94 passed |
| Control Center collector/projector | collector typecheck and focused projector/persistence tests | 54 passed; DB-backed local tests require the host `libpq` runtime |
| Control Center web shell | web-shell typecheck and full test | 259 passed, including 7 weekly-chain tests |
| Control Center browser/build path | `npm run test:e2e` | 12 adapter tests and production build passed; this host lacked `libnspr4` for the optional browser launch and used the explicit fallback |

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
- receipt absence preserved as contractual `UNKNOWN` and presented as `sem dados`, never zero;
- unsafe free-form canonical identity dropped/rejected.
- producer schema, real-only flags, source month, route, and authority drift fail closed;
- duplicate correlations are withheld instead of selecting an arbitrary row;
- raw future tokens remain only in technical metadata while the reading stays in pt-BR;
- inherited/prototype values cannot authorize a decision or financial state;
- an observed zero is rendered only when integer cents and an ISO currency arrive together.
- financial timestamps containing PII, impossible dates, or instants after collection fail closed for both charge and receipt and never reach HTML.

No real smoke was run because the task explicitly prohibits real charge creation, client contact, and PII transmission. The sandbox evidence exercises software behavior only; it is not inserted into the real-only Control Center projection as if it were production telemetry.
