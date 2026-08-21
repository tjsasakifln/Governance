# Control Center — HOJE (`today-ui`)

Isolated homepage for Confenge Control Center. **Exception cockpit**, not chat, not a KPI wall, not an ERP.

Ownership path: `control-center/apps/today-ui/`. Sibling Control Center packages are not imported. Local types copy v1 field names (`source`, `observed_at`, `freshness_status`, `confidence`) until the convergence campaign.

## Information order (frozen)

1. Top 3 ações recomendadas (cap 3)
2. Incidentes/blockers/riscos
3. Clientes que exigem atenção
4. Comercial em exceção
5. Financeiro em exceção
6. Engenharia/infra em exceção
7. atividade recente de agentes
8. shortcuts para registrar decisão/nota

Healthy KPIs are compressed so they can be ignored. `STALE` / `UNKNOWN` / `ERROR` never render green. A founder override (`pin` / `reorder` / `dismiss`) is marked on the affected Top 3 item. No decorative charts. Money is integer cents + ISO currency. Internal times are UTC (`Z`); presentation uses `America/Sao_Paulo`.

## Decisions (local)

- Governance remains the strategic/canonical authority; Warmbly remains the commercial/CRM operational authority. This module only **renders** a read-model recorte.
- PostgreSQL, HTTP, MCP, collectors, attention engine, agent ledger, and directives UI land in **later convergence**. This package copies the v1 shapes and documents the ports in `src/adapters.ts`.
- Pure `composeHoje(payload) → HojeView`. I/O (fixture load, CLI dump, HTML paint) stays at the edges. Tests drive compose, not a reimplementation.
- Single-user human is implicit. Operator handle on an override is `human:operator`. No identity, password, or secret is hardcoded.
- Shortcuts (`Registrar decisão`, `Registrar nota`) call `recordIntent`, a local adapter: `accepted: true`, `persisted: false`, `mutates_external: false`. No Warmbly / Asaas / GitHub / provider write.
- Fail-closed freshness: only exact `FRESH` may be green. Unknown values map to slate, never green.
- Ranking is **not** redone here. Attention-engine output arrives already ranked; this UI caps at 3 and flags founder override visibility.

## Run (no env vars required)

Requires Node ≥ 20.

```bash
cd control-center/apps/today-ui
npm install
npm test
npm run typecheck
npm run dump -- incendio-operacional
npm run page -- incendio-operacional
npm run generate-public
```

Open `public/hoje.html` from disk (`file:`) or via any static server. The page uses `<script src="./hoje.js">` (classic script, not ES modules). `public/hoje.html` is the fire fixture; also generated: `hoje-dia-saudavel.html`, `hoje-incendio-operacional.html`, `hoje-dados-stale.html`, `hoje-zero-atividade.html`.

Real package entry (deterministic on a frozen fixture):

```bash
npx tsx src/cli.ts dump incendio-operacional
```

Run it twice; the JSON must match.

### Named fixtures

| Name | What the founder should see |
| --- | --- |
| `dia-saudavel` | Top 3 routine; exception/KPI bands compressed (ignore) |
| `incendio-operacional` | Top 3 + incidents + domain exceptions expanded; founder pin visible |
| `dados-stale` | Data shown, non-green, not trusted/fresh |
| `zero-atividade` | Empty Top 3 and agent/exception bands; no invented work |

## Env vars

None required. Do not put secrets in git, URLs, logs, analytics, or a client bundle. There is no analytics SDK here.

| Variable | Effect |
| --- | --- |
| _(none)_ | Fixture-backed compose; no live I/O |

## Expected later convergence

| Later workstream | Expected swap |
| --- | --- |
| `control-center/contracts` | Replace local types with the published JSON Schema / TS package. |
| Attention engine | `RankOutput.today` → `recommended_actions`; `FounderOverride` → `founder_override`. |
| Agent ledger | `TimelineItem` → `agent_activity`. |
| Context HTTP | `GET` scoped recorte → `HojePayload`. |
| Directives UI | Shortcuts become draft directives. This wave stays local intent only. |
| Mobile shell | Shell chrome can iframe or import this compose/render. Not absorbed here. |

Do not merge this package into `commercial/`, `decisions/`, `scripts/`, or other Control Center workstreams in this campaign.

## Tests

```bash
npm test
npm run typecheck
```

Tests call the shipped `composeHoje` once per named fixture and assert band order, Top 3 cap, compression, freshness tones, founder-override visibility, and `charts_emitted: false`.
