# Control Center Attention Engine

Deterministic ranking for **ATENÇÃO AGORA** (exceptions) and **se eu só puder fazer 3 coisas hoje** (homepage top-3). This package is the v1 ranking path: **no LLM**, no I/O, no provider mutations.

Ownership path: `control-center/intelligence/attention/`. Sibling Control Center packages are not imported; local types and adapters document the interface for a later convergence campaign.

## Decisions

1. **Pure function.** `rankFromUnknown` / `rankAttention` take signals + scoring config + frozen clock + optional founder override. Same inputs always produce the same ordered ids, scores, and reasons.
2. **Integer millipoint math.** Scores are reconstructible from the emitted `score_breakdown`:
   ```
   axis = impact_weight_bp * impact + urgency_weight_bp * urgency
   raw  = floor(category_weight * axis / 10000)
   score_milli = floor(raw * 1000 * freshness_bp * confidence_bp / 10000²)
   score = score_milli / 1000
   ```
3. **Urgency cannot erase impact.** Config invariant: `impact_weight_bp > urgency_weight_bp` (default 7000 / 3000).
4. **Category tiers.** Primary (`receita`, `cliente`, `prazo`, `risco_operacional`, `blocker`) outranks secondary (`estetica`, `refactor`) before score is compared. A max-urgency cosmetic item cannot beat a primary-category item.
5. **Total order (tie-break).** kill-rule → category tier → `score_milli` → category weight → impact → urgency → id ascending. Distinct ids never tie.
6. **Merge.** Signals that share `correlation_key` become one item (max impact, max urgency, worst freshness, min confidence, union of evidence). They do not compete as separate rows.
7. **Kill rules.** `risco_operacional` or `blocker` at `critical` severity are forced to the front of ATENÇÃO AGORA so low-value work cannot crowd them out.
8. **Freshness.** Non-`FRESH` multiplies the score down (`STALE` 0.45, `UNKNOWN` 0.55, `ERROR` 0.35) **and** emits an explicit `Dados stale: …` item.
9. **Domain diversity** applies to the today-3 only. ATENÇÃO AGORA is an exception list and may repeat a domain. Greedy: pick global best, then the best remaining item of an unused domain, then fill.
10. **Founder override** is an input record (`pin` | `reorder` | `dismiss`) plus an audit event naming actor, time, target ids, and the ranking before/after. Not a hidden branch. Pinning a cosmetic item does not hide a kill-rule from ATENÇÃO AGORA unless the founder dismisses it.
11. **Provenance.** Every aggregated signal and the engine envelope carry `source`, `observed_at`, `freshness_status`, `confidence`. Engine output provenance is `FRESH` (the ranking was just computed); item provenance is that of the merged signal.
12. **Fail-closed validation.** Runtime checks on ids, scopes, enums, money (integer cents + ISO currency), UTC `Z` timestamps, and forbidden secret-bearing keys. No identity or password is hardcoded; the founder handle arrives on the override record.
13. **Money** is integer cents + `currency`. The engine does not charge, refund, or call Asaas.

## How to run

Requires Node ≥ 20. From this directory:

```bash
npm install
npm test
npx tsc --noEmit
npm run rank -- fixtures/representative.json
```

`npm run rank` is the real package entry (CLI over a checked-in fixture). It writes ranking JSON to stdout. Run it twice; the outputs must match when the fixture freezes `now`.

Tests live under `tests/` and call the **shipped** `rankFromUnknown` — they do not reimplement the ranker.

## Env vars

None required. The ranker is config-as-data on the request body.

| Variable | Effect |
| --- | --- |
| `CC_ATTENTION_LOG=1` | Structured JSON logs on stderr (ids, counts, fingerprint only — no PII, no secrets) |

Do not put API keys, tokens, or passwords in the request, logs, URLs, or a client bundle. Validation rejects secret-shaped property names.

## Request / output contract

Input (JSON):

```json
{
  "now": "2026-08-20T15:00:00.000Z",
  "signals": [ { "id": "cc:attention-signal:…", "category": "receita", "…": "…" } ],
  "config": { "category_weights": { "cliente": 120 } },
  "override": {
    "actor": { "kind": "human", "id": "human:founder" },
    "at": "2026-08-20T15:05:00.000Z",
    "action": "pin",
    "target_ids": ["cc:attention-signal:…"]
  }
}
```

`config` and `override` are optional. `now` should be set for determinism (tests and the CLI fixture freeze it).

Output:

- `attention_now` — ATENÇÃO AGORA, ranked, each with `reason`, `evidence_refs`, `score_breakdown`
- `today` — at most 3 items, domain-diverse
- `audit` — founder override events (empty if none)
- `config_fingerprint` — sha256 prefix of canonical config
- envelope `provenance`

## Local vocab vs siblings (do not import)

This package copies the *shape* of cc-01 contracts, not the package.

| Field | This engine (contracts-shaped) | Persistence (cc-02) |
| --- | --- | --- |
| freshness | `FRESH` `STALE` `UNKNOWN` `ERROR` | `fresh` `stale` `unknown` `expired` |

`ERROR` ↔ `expired` is an explicit divergence. Use `toPersistenceFreshness` / `fromPersistenceFreshness` at convergence. Do not wait on those packages in this campaign.

Horizons: `now` | `today` | `this_week`. Homepage limit: `HOMEPAGE_PRIORITY_LIMIT = 3`.

## Expected later integration

- **Homepage:** exceptions from `attention_now`; the three things from `today`. Not a KPI wall.
- **MCP / context service:** agents query by `scope`. Filter ranked items to granted scopes; never dump company-wide memory.
- **Persistence:** store derived attention items / priority recommendations. This engine remains pure — no SQL, no collectors.
- **Collectors (GitHub, Warmbly, Asaas, PNCP):** emit `AttentionSignal`s with provenance. Read-only. This campaign does not wire them.

`asPriorityRecommendations(output, horizon)` maps engine rows onto the contracts `PriorityRecommendation` shape (`rationale` = `reason`) without importing cc-01.

### `reason` is two things in one string

`reason` mixes an operator-readable note with the scoring arithmetic and the
evidence locators. A cockpit needs them apart — `peso_categoria`, `eixo`,
`freshness_bp`, `confidence_bp` and the `KILL-RULE` banner are engine vocabulary
and belong behind a disclosure, never on the front of a card.

`explain.ts` therefore has one producer and one published inverse:

- `buildReasonParts(item, horizon)` → `{ plain, formula, evidence }`
- `joinReasonParts(parts)` → the exact wire string (`buildReason` is these two composed)
- `splitReason(reason)` → `{ plain, technical }`, where `technical` starts at the
  arithmetic sentence and carries the evidence locators with it
- `SCORE_SENTENCE_RE` — the anchor, published so a consumer does not guess it

The wire bytes are unchanged: `buildReason` still emits exactly what it emitted
before, and `attention_entry.reason` in `operational-envelope.v1` is untouched.

## Non-goals

Homepage UI, MCP server, PostgreSQL schema, live collectors, LLM ranking, writes under `commercial/` or other Control Center workstreams, provider mutations (charge, checkout, refund, cancel, Asaas changes, commercial send).
