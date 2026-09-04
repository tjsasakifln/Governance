# Checklist red-team — gate de rejeição (campanha 15)

Usar como **rejeição**, não como narrativa de sucesso. Caveats no final **não** podem ser apagados para “passar”.  
PRs futuras das campanhas 01–14/16/97–99 **não foram revisadas**. `NO_FINAL_REVIEW_CLAIM=CONFIRMED`.

SHAs inspecionados: Governance `230d73a22a321112abe09b34a0d5fe743790b857` · web-cfg `89b081a8676d8a0b30747dfcb1477f21d9ac4dfb` · warmbly `8602ce4ae68e27080fa4431390194c09c2b76d06` · meetcfg `26f79e3fd414b12e765b6ec243e47a90c8a9b226` · extra-cli `3919f4d9af1363e2db641c7edadb8a8404874ec4`.

Marque `REJECT` se o item falhar. `PASS` só com evidência no SHA candidato. `N/A` exige dono e motivo escrito.

## 1. Estratégia e fachada

- [ ] **REJECT** se home/nav/footer/CSS mudam o rótulo para guarda-chuva **sem** utilidade privada nova (job do visitante + tempo até evidência). → PM-10-001
- [ ] **REJECT** se taxonomia ADR/AGENTS vira catálogo que um gate lê. → PM-02-001
- [ ] **REJECT** se catálogo/schema publica página precificada ou segundo catálogo gravável. Pin web-cfg `e2b0498a` **não** é o Governance main. → PM-03-001
- [ ] **REJECT** se credencial vira endorsement, vitrine ou ART universal. → PM-04-001
- [ ] **REJECT** se `/casos/` ou copy QA inventa prova (`approved_public_proof_count` continua 0 em main). → PM-12-001

## 2. Interfaces e dual-owner

- [ ] **REJECT** se dois owners editam no mesmo intervalo: `index.html`, `js/modules/form.js`, `data/organic/public-family-registry.json`, `package.json`, `styles.css` (e correlatos na matriz). → PM-97-001
- [ ] **REJECT** se campanha 02 toca HTML público, 03 regenera `entregas/`, 08 regenera páginas, 13 altera `script.js`/`analytics.js`, 12 publica prova. Ver `ownership-conflict-matrix.json`.
- [ ] **REJECT** se `git add -A` / `git add .` / worktree de outro agente / captura de arquivo alheio. → PM-97-001
- [ ] **REJECT** se PRs web-cfg `#549` `#548` `#544` `#536` `#535` `#524` `#523` `#522` (base `81c600b7`) entram como “cleanup” de 01. → PM-01-001

## 3. Privacidade e conflito

- [ ] **REJECT** se PII de processo, saúde, empregados, planta ou conflito entra em URL, event ou log. → PM-08-002, PM-05-001
- [ ] **REJECT** se `/conflitos/` ganha `shared_lead_form_v1` ou contestação vira analytics/`wa.me` com fatos sensíveis. → PM-05-001
- [ ] **REJECT** se recibo/email/CNPJ/`tax_identifier_export` aparece em `location.search` ou envelope de evento. → PM-08-002
- [ ] **REJECT** se readback HTTP Warmbly ecoa `LeadEmail`/`RawPayload` como se fosse métrica. → PM-07-002

## 4. UNKNOWN, draft, HTTP 2xx

- [ ] **REJECT** se `UNKNOWN` vira `CAN_ACCEPT`, clearance, ausência ou sucesso. `CAN_ACCEPT` sintético com `promise_allowed=false` **não** é vaga. → PM-06-001, PM-16-001
- [ ] **REJECT** se consumers tratam draft (`*-draft`, item nativo sem `decision`, overlay unvalidated, pin stale) como runtime. → PM-09-001, PM-14-001
- [ ] **REJECT** se HTTP 2xx / exit 0 / health 200+BLOCKED / refresh `ok:true` sem ACCEPTED do produtor é lido como aceite ou readback. → PM-08-001, PM-07-002, PM-14-001, PM-98-001
- [ ] **REJECT** se honeypot 200 + `lead_id` fake dispara `lead_persisted` (defeito **já em main** `form.js` L521 / `lead.cjs` honeypot). → PM-08-001
- [ ] **REJECT** se Meetcfg pinta `status=ACCEPTED` com `outcome=UNKNOWN` ou item sem decisão. → PM-14-001
- [ ] **REJECT** se `ISOLATED_PASS` / `NXDOMAIN` / “serviço no ar” fecha `#65`. → PM-98-001

## 5. B2G, SEO, UX, canário, hub

- [ ] **REJECT** se `/diretoria-b2g/`, `/diagnostico-b2g-360/`, `/bid-room-licitacoes-obras/`, `/defesa-margem-contratos-publicos/` perdem URL, canonical, link ou intent. 301 para home é proibido. → PM-10-001
- [ ] **REJECT** se canário exige contato para revelar valor, usa `n` como score sem proveniência, ou canoniciza `/piloto/` no host de produção com follow. → PM-09-001
- [ ] **REJECT** se hub local é doorway / city farm / indexável. `new_public_landing_created` deve permanecer false até utilidade distinta. → PM-11-001
- [ ] **REJECT** se Netlify scheduled leftover vira plano público. → PM-01-001

## 6. Inbound vs outbound

- [ ] **REJECT** se inbound herda `outbound_eligible`, SMTP, follow-up ou conta extra-cli send-ready (email/CNPJ match). → PM-07-001
- [ ] **REJECT** se `CONFENGE_AUTO_SEND_ENABLED` não é false, ou `GenerateDraft`/consumer dispatch age em `inbound_only`. → PM-07-001
- [ ] **REJECT** se Meetcfg postcall agenda follow-up em lane inbound sem `inbound_only=true`. → PM-14-001
- [ ] **REJECT** se ACCEPTED Governance inbound tiver `smtp_authorized` ou `followup_authorized` true. → PM-06-001

## 7. Rollback, promote, worktrees

- [ ] **REJECT** se rollback apaga receipt/lead **ou** reabre checkout/canário/SMTP via SHA antigo + store compartilhado. → PM-99-001
- [ ] **REJECT** se `release()` de `RECONCILIATION_REQUIRED` libera capacidade sem `RECONCILE_RESOLVE`. → PM-16-001
- [ ] **REJECT** se 99 promove com `promise_allowed=false`, staffed UNKNOWN, matrix ACTIVE sem hash no manifest, ou isolated PASS. → PM-99-001
- [ ] **REJECT** se worktrees compartilham `_site`, Blobs, sqlite, checkpoints extra-cli, ou se `git -C $WT` não é o HEAD da campanha. → PM-97-001, PM-XCLI-001
- [ ] **REJECT** se 15/97 alega ter revisado PRs que ainda não existiam neste snapshot.

## 8. Blockers atuais fora da matriz (não ticketizar em massa)

Registrar, apontar owner, **não** implementar aqui:

- Honeypot/200 já em produção — web-cfg captura (`#61` / `#580`)
- Pin Governance stale `e2b0498a` / PR 9 — pin owner + `#1`
- Sem CODEOWNERS — processo 97
- `#65` OPEN + `SCHEMA_MISMATCH_COLLECTION` — Warmbly `#47`; 98 audita; 99 **não** fecha
- Sem staffed REAL `#123`; 54/54 UNKNOWN `#122` — delivery; 16 não inventa
- Netlify leftover vs Netcup — runtime authority
- Design gates ignoram `.worktrees` — quality `#599`
- Meetcfg `WARMBLY_PRODUCER_SHA=cc11a9ab` ≠ warmbly `8602ce4a` — Meetcfg 14
- Overlay `UNKNOWN → PRESERVE_AND_HOLD` vs delivery fail-closed — 97

## Caveats (obrigatórios — não simplificar)

1. Defesas já existentes em main **continuam válidas**: registry fail-closed, flags de checkout off, Disallow `/piloto/`, `AUTO_SEND=false`, constraint SQL inbound_only, Meetcfg fail-closed collection≠dossier, extra-cli `HTTP_200_NOT_PROOF`, documentação v2 UNKNOWN≠CAN_ACCEPT, store de leads que sobrevive rollback (feature **e** risco).
2. Create path de `lead.cjs` **é** 201; o furo é o **cliente aceitar 200** + honeypot.
3. Policy inbound ACTIVE ≠ issue `#65` fechada ≠ consumer pinado.
4. `CAN_ACCEPT` sintético não é vaga vendável **a menos que** o consumidor ignore `promise_allowed`.
5. Pacote TXT V3 ausente; a matriz do prompt da campanha 15 é a autoridade deste checklist.
6. Identidade de worktree exige `git -C $WT`. HEAD no clone canônico (`feat/120-e2e-financial-chain`) **não** é este pré-mortem.
7. Sem merge, deploy, SMTP, provider ou produção nesta campanha.

## Aplicação no goal 97

Executar `acceptance-test-manifest.json` (aceite **e** negativos) e esta lista. Um único `REJECT` bloqueia 99. Não converter esta lista em “tudo verde” apagando caveats.
