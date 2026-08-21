# Mobile matrix

Playwright Chromium launched then failed on host library `libnspr4.so`. Classified as OS-lib launcher failure (`isOsLibLauncherFailure`). Screenshots were **not** captured. `MOBILE_FIRST_PROVEN_360_390_430=false`.

Launcher evidence: `{SCRATCH}/playwright-env.log` and `{SCRATCH}/launch-1.log` / `launch-2.log`. Both launches booted Context+web (`context_risks=1 context_priorities=1`) then failed identically at Chromium.

Accepted launch bar without viewport screenshots (plan fallback):

| Page | 360 | 390 | 430 | desktop |
| --- | --- | --- | --- | --- |
| Hoje | CSS+unit | CSS+unit | CSS+unit | CSS+unit |
| Comercial overview | CSS+unit | CSS+unit | CSS+unit | CSS+unit |
| Cohorts | CSS+unit | CSS+unit | CSS+unit | CSS+unit |
| Commercial activity | CSS+unit | CSS+unit | CSS+unit | CSS+unit |
| Clients | CSS+unit | CSS+unit | CSS+unit | CSS+unit |
| Client detail | CSS+unit | CSS+unit | CSS+unit | CSS+unit |
| Finance | CSS+unit | CSS+unit | CSS+unit | CSS+unit |
| Engineering | CSS+unit | CSS+unit | CSS+unit | CSS+unit |
| Infra | CSS+unit | CSS+unit | CSS+unit | CSS+unit |
| Growth/Inbound | CSS+unit | CSS+unit | CSS+unit | CSS+unit |
| Directives/Memory | CSS+unit | CSS+unit | CSS+unit | CSS+unit |

Static/unit evidence:

- `html, body { overflow-x: hidden }`
- `.nav` / `.subnav` `overflow-x: auto`; touch targets `min-height: 44px`
- `tests/ux.test.ts` overflow + skip-link + keyboard nav
- `tests/commercial-ops.test.ts` surfaces
- `tests/view-state.test.ts` loading/error/stale/empty
- launch-probe now visits all destinations + comercial/{cohorts,atividade,pipeline,excecoes} + clientes/acme at 360/390/430/desktop and asserts overflow ≤1px **when Chromium can start**

LIVE_ENVIRONMENT_GATE: install `libnspr4`/`libnss3` (or run CI Playwright install-deps) to capture real screenshots.
