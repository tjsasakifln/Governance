# Pré-mortem independente — matriz multivertical 2026-09-04

**Campanha 15.** `EXECUTION_MODE=PRE_MORTEM_INDEPENDENTE`.  
**Não é revisão de PRs futuras.** Nenhuma campanha 01–14, 16, 97, 98 ou 99 foi tratada como já implementada. Os achados atacam o código contemporâneo e o plano da matriz; o goal 97 deve aplicar os testes negativos deste pacote.

`NO_FINAL_REVIEW_CLAIM=CONFIRMED`

## Identidade da inspeção

| Repo | SHA `origin/main` | Worktree (exclusivo) | HEAD subject |
| --- | --- | --- | --- |
| tjsasakifln/Governance (escrita) | `230d73a22a321112abe09b34a0d5fe743790b857` | `.worktrees/Governance/c20260904-15-premortem` branch `audit/campaign-20260904-multivertical-premortem-v3` | fail closed on missing policy version (#167) |
| tjsasakifln/web-cfg | `89b081a8676d8a0b30747dfcb1477f21d9ac4dfb` | `.worktrees/web-cfg/c20260904-15-premortem-ro` detached | runtime ops/retention (#586) |
| tjsasakifln/warmbly | `8602ce4ae68e27080fa4431390194c09c2b76d06` | `.worktrees/warmbly/c20260904-15-premortem-ro` detached | sales-context schema split |
| tjsasakifln/meetcfg | `26f79e3fd414b12e765b6ec243e47a90c8a9b226` | `.worktrees/meetcfg/c20260904-15-premortem-ro` detached | fail-closed Warmbly pull (#2) |
| tjsasakifln/extra-cli | `3919f4d9af1363e2db641c7edadb8a8404874ec4` | `.worktrees/extra-cli/c20260904-15-premortem-ro` detached | commercial-plane authority (#543) |

Pacote TXT V3 opcional: **ausente**. A matriz autoritativa deste relatório é a do prompt da campanha 15. Worktrees funcionais de outras campanhas (ex.: `c20260904-06-governance-intake`) **não** foram usados como fonte.

## Autoridades atuais (issues/PRs abertas — não fechadas por este pré-mortem)

- Governance: `#1` autoridade comercial, `#65` hand-raiser net-new (OPEN apesar da policy ACTIVE em main), `#120` E2E, `#122` readiness 54/54, `#123` capacidade staffed, `#127` readback piloto.
- web-cfg: `#577` epic guarda-chuva, `#578` substituir travas B2G exclusivas, `#580` triagem sem vazar dados, `#581` credenciais, `#582` home/nav, `#583` catálogo multi-vertical, `#585` conflitos, `#587`/`#588` ofertas B2G, `#442` logs, `#410` CSP. PRs abertas contra base antiga (`81c600b7…`, não o main atual): `#549` `#548` `#544` `#536` `#535` `#524` `#523` `#522`.
- Warmbly: `#43` GO/NO-GO outbound, `#47` consumer (referenciado pela policy), `#117` incidente inbound, `#155` first-touch QUEUED.
- Meetcfg: consumer/view; `#1` do contrato de admissão. extra-cli: plano comercial pinado em `docs/contracts/confenge-commercial-plane/v1/operating-authority.json`.

## Como ler os achados

Cada finding: `ID | severity | campaign owner | repo/path/symbol | invariant | reproduction | test to add | reject condition | rollback implication`.

Severidades: `blocker` = já quebra o contrato em main; `high` = a campanha nomeada pode promover o defeito se não for rejeitada; `medium`/`low` = residual. Caveats no final **não** foram removidos para “passar” o checklist.

---

## Findings

### PM-08-001 | blocker | 08 | web-cfg `netlify/functions/lead.cjs` honeypot + `js/modules/form.js` L521

- **invariant:** HTTP 2xx não é aceite. Persistência real é 201 (ou replay idempotente de registro **já** no store). Recibo sem store é fraude de conversão.
- **reproduction:** Honeypot devolve `statusCode: 200` + `lead_id` fake. O cliente aceita `(res.status === 201 \|\| res.status === 200) && data.ok && (data.lead_id \|\| data.receipt_id)`, dispara `lead_form_success`/`lead_persisted`, grava `confenge_last_receipt` e navega `?receipt=`. O comentário em `lead.cjs` (“no 200 when not persisted”) já é violado em main `89b081a86`. Replay 200 e honeypot 200 colapsam no mesmo predicado.
- **test to add:** POST honeypot: cliente **não** chama `finishOk`; 200 + `status=suppressed` nunca emite `lead_persisted`. Só 201 create ou 200 `idempotent:true` com hit no store.
- **reject condition:** Qualquer path 2xx sem persistência emite `lead_persisted`, obrigado com recibo, ou handoff Warmbly.
- **rollback implication:** Recibos falsos em sessionStorage/analytics/referrer logs sobrevivem ao revert do JS. Warmbly pode tratar `lead_id` honeypot como pipeline se o handoff disparar.

### PM-07-001 | high | 07 | warmbly `internal/app/confenge/inbound_only.go` `AdmitInboundOnly` / `web_intent.go` / `inbound_ingest.go`

- **invariant:** Inbound não herda eligibility/follow-up outbound. Conta extra-cli send-ready não é o destino de um hand-raiser.
- **reproduction:** Email já em conta com `EmailSendReady`/`TargetFitEligible` e `SourceSystem != inbound_only`: `FindCandidateByEmail` acerta primeiro, `AdmitInboundOnly` é pulado, `OutboundEligible` permanece true. POST inbound com CNPJ de conta extra-cli anexa a action nessa conta. `ensureInboundAccount` pode criar `SourceSystem: "web-cfg"` com `NeedsContact`, não `inbound_only`. `GenerateDraft` não consulta `AccountIsInboundOnly`; o consumer ainda monta dispatch governor. Fast-lane bloqueia send, mas draft/API são segunda autoridade.
- **test to add:** Reuso de email contra conta outbound → `outbound_eligible:false` e sem `confenge_dispatch_sends`. CNPJ match não copia `EmailSendReady`.
- **reject condition:** HTTP 201 com `outbound_eligible:true` em intake 07, ou action inbound no `account_id` extra-cli outbound.
- **rollback implication:** Reverter o código 07 **não** desfaz o match na conta outbound nem as flags de send. Drafts persistidos permanecem.

### PM-14-001 | high | 14 | meetcfg `backend/app/copilot/handraiser.py` `consume` / `render_conversation_layer` / `api_handraiser_refresh`

- **invariant:** Só `ACCEPTED` do produtor é autoridade de runtime. HTTP 200 não é readback. `UNKNOWN`/ausência de `decision` não vira sucesso. Native item sem estado fechado não liga sessão.
- **reproduction:** Item nativo Warmbly sem `decision`/`outcome`: `_closed_state` é `None`, `consume` não falha `UNKNOWN_OUTCOME`, `render_conversation_layer` pinta `"status": ACCEPTED`, `ReceiptStore.put` liga `hr:<action_id>`. Refresh sem credenciais: HTTP 200 e `ok:true` com `PRODUCER_NOT_CONFIGURED`; UI mostra “atualizado”. Export 200 com `accepted=0` ainda `ok=True`. Native inbound **não** traz `inbound_only`; postcall pede follow-up de e-mail. `WARMBLY_PRODUCER_SHA` pinado (`cc11a9ab…`) **não** é o main atual `8602ce4a`.
- **test to add:** Native sem `decision` → `ok=False` `UNKNOWN_OUTCOME`. Refresh sem producer → `ok=false`. `accepted=0` não é “atualizado”. `status=ACCEPTED` e `outcome=UNKNOWN` não coexistem.
- **reject condition:** Sessão bound ou UI ACCEPTED/atualizado sem decisão fechada do produtor.
- **rollback implication:** Store in-process some; desligar `handraiser_consumer_enabled` e não puxar Warmbly. Pin SHA desatualizado sobrevive e admite envelope errado.

### PM-06-001 | high | 06 | Governance `delivery/capacity.py` `evaluate_admission_v2` + `evaluate_admission` v1; `commercial/inbound/admit.py`

- **invariant:** `UNKNOWN` nunca é `CAN_ACCEPT`, ausência ou sucesso. v2 é o único motor (`ADMISSION-CONTROL.md`). `CAN_ACCEPT` sintético não é promessa. Exit 0 / HTTP 2xx do avaliador não é ACCEPTED.
- **reproduction:** Fixtures sintéticas (`capacity-synthetic-one.v2.json`) produzem `decision=CAN_ACCEPT` com `evidence_class=SYNTHETIC` e `promise_allowed=False`. v1 ainda exporta `CAN_ACCEPT` **sem** `promise_allowed`; `project_capacity_read_only` liga `can_accept` se `CAN_ACCEPT and not synthetic`. CLI `python -m commercial.inbound` imprime UNKNOWN e **exit 0**. Mix unknown+reject em `admit.py` pode fazer o consumidor tratar códigos de reject como fechamento. Policy `NET_NEW_INBOUND_HANDRAISER-v1` está ACTIVE; `#65` permanece OPEN.
- **test to add:** Consumidor falha se `CAN_ACCEPT` e (`evidence_class!="REAL"` ou `promise_allowed!=True`). v1 inacessível a produção. CLI/processo distingue `transport_ok` de `decision`.
- **reject condition:** Campanha 06/99 documentando `CAN_ACCEPT` sem `promise_allowed` REAL, ou consumidor tratando exit 0 como ACCEPTED.
- **rollback implication:** Projection é read-model; rollback **não** desfaz uma UI que já mostrou vaga. Ledger MODEL_ONLY não é recibo.

### PM-10-001 | high | 10 | web-cfg `index.html` + `js/modules/nav.js` + `styles.css` / `assets/home-10x.css` + `CANONICAL_DESTINATIONS`

- **invariant:** Reposicionamento sem utilidade privada é fachada. URLs B2G (`/diretoria-b2g/`, `/diagnostico-b2g-360/`, `/bid-room-licitacoes-obras/`, `/defesa-margem-contratos-publicos/`) conservam URL, canonical, link e intent. Home/nav/footer/CSS não têm dois owners no mesmo dia.
- **reproduction:** Home, JSON-LD, nav e footer em `89b081a86` são exclusivamente “licitações e contratos de obras públicas”. `#578` pede substituir travas B2G; `#582` reconstrói home. CSS-only ou relabel de nav pode apagar as três portas B2G do chrome enquanto sitemap/analytics ainda mapeiam as rotas. `index.html` também embute o form (`#formulario-contato`, campanha 08) e o CSS crítico vs `home-10x.css` (já houve inversão de cascata). Sem CODEOWNERS.
- **test to add:** Cada chave B2G em `CANONICAL_DESTINATIONS` tem 200, self-canonical, link em nav **ou** footer, e linha no family registry. Diff de 10 que só muda CSS/copy sem job do visitante falha o market-capture gate. Sobreposição de 10+08 no mesmo `index.html` falha o lock.
- **reject condition:** Home “guarda-chuva” sem utilidade nova **ou** perda de URL/canonical/intent B2G **ou** dois owners no mesmo arquivo.
- **rollback implication:** `AGENTS.md` proíbe 301 blanket para home. GSC/canonicals antigos permanecem. Reverter 10 reverte o form da 08 se compartilharam o HTML.

### PM-02-001 | high | 02 | web-cfg `AGENTS.md` / ADRs vs `data/organic/public-family-registry.json` vs `data/organic/bofu-intent-matrix.json` vs extra-cli identity

- **invariant:** Taxonomia não é segunda source of truth. extra-cli possui fatos/identidade; o registry é a declaração das famílias indexáveis; HTML renderizado é a prova.
- **reproduction:** Pilares apontam por **pointer** para a matriz BOFU. Lighthouse/policy precisa igualar family ids. Campanha 02 pode escrever ADR/AGENTS/taxonomia sem atualizar HTML+registry+matriz — três verdades. extra-cli `AGENTS.md` já avisa: DOD/ADR/código prevalecem sobre este arquivo.
- **test to add:** Toda rota indexável ∈ exatamente uma família; rotas da matriz ⊆ registry; docs não listam família ausente no registry; nenhum gate lê ADR como catálogo.
- **reject condition:** Gate de conversão/SEO usando taxonomia documental em vez do registry+HTML.
- **rollback implication:** Reverter ADR sem registry deixa o CI verde em famílias velhas.

### PM-03-001 | high | 03 | web-cfg `data/offers/catalog.snapshot.json` + `entregas/catalog-data.js` vs Governance `commercial/offers/catalog.v1.json` + pin `data/offers/governance-authority-pin.json`

- **invariant:** Catálogo/schema não publica páginas. Pin não copia Governance para um segundo catálogo gravável. Draft/APPROVED interno ≠ vitrine.
- **reproduction:** Snapshot web-cfg `status: APPROVED` com preços; flags `CONFENGE_OFFER_CATALOG_PUBLIC: false`. `entregas/` já renderiza `GENERATED:PUBLIC-CATALOG`. Pin aponta `governance_pr: 9` e SHA `e2b0498a…`, **não** `230d73a`. Governance catalog `publication_status: NOT_PUBLISHED`, exclusões incluem `survey_design_art_rrt_testing_expert`. Campanha 03 (schema) + 04 (credencial/ART) + 10 (hub) podem divergir.
- **test to add:** Nomes/preços no HTML público ⊆ snapshot com flag on **e** hash do manifest Governance; pin SHA == `origin/main` Governance; VALIDATE items não parecem contratáveis.
- **reject condition:** Schema change visível como oferta precificada **ou** pin SHA ≠ main **ou** segundo catálogo gravável.
- **rollback implication:** JS gerado em `entregas/` pode não reverter com rollback só do schema.

### PM-04-001 | high | 04 | web-cfg `especialista/tiago-jun-sasaki/index.html` + `confianca/index.html` + termos `comercial/termos-diagnostico-b2g/`

- **invariant:** Credencial ≠ endorsement, storefront ou ART universal. CREA/ART só com fato de registro; captura precificada não mora em página de confiança sem isenção `trust_or_legal`.
- **reproduction:** Perfil indexável (`index,follow`), JSON-LD Person `knowsAbout` B2G, CTA primário é form/WhatsApp. **Não há número CREA.** Termos excluem ART/RRT; a mesma chrome vende diagnóstico. `#581` pede credenciais periciais/SST/avaliações — risco de virar vitrine de selo.
- **test to add:** `/especialista/` e `/confianca/` sem captura precificada (ou isenção explícita); zero claim ART/RRT/endosso; CREA só se o registry de prova tiver o fato.
- **reject condition:** Linguagem de ART universal, selo, ou storefront de credencial.
- **rollback implication:** Grafo Person indexado permanece no GSC após o HTML reverter.

### PM-05-001 | high | 05 | web-cfg `conflitos/index.html` `#contestacao` + form compartilhado

- **invariant:** Conflito público é contestável sem PII de processo/saúde/empregados/planta/conflito em URL, event ou log. `/conflitos/` não herda `shared_lead_form_v1`.
- **reproduction:** Página `index,follow`, política 1.1.0 sem registro estruturado de engajamentos conflitantes. Contestação = mailto + `wa.me?text=` (texto livre). JSON-LD Organization ainda descreve só obras públicas. Campanha 05+08 no mesmo chrome puxa `track()` e FormData completo (inclui CNPJ em outras rotas).
- **test to add:** `/conflitos/` sem `<form action="/.netlify/functions/lead">`; payload de contestação não é evento analytics; nenhum campo de processo/saúde/planta no querystring.
- **reject condition:** Narrativa de conflito ou PII sensível em event/URL/log **ou** form de lead na página de conflito.
- **rollback implication:** Política 1.1.0 indexada fica em cache. Threads de WhatsApp não revertem.

### PM-09-001 | high | 09 | web-cfg `piloto/index.html` + `data/conversion/canary-flag.json` + fixtures `*-draft`

- **invariant:** Canário privado não exige contato para revelar valor, não usa score enganoso, não é autoridade de runtime, não indexa. Draft ≠ live.
- **reproduction:** Hub `noindex,nofollow` **com** `rel=canonical` `https://confenge.com.br/piloto/`. Filhos `noindex,follow`. Lista 15 páginas com `n` contratos como se fossem score. Header global ainda pede contato. `canary-flag.json` `enabled:false` mas `intake_path` e `cta_copy` existem; `netlify.toml` empacota `data/conversion/**` (schemas `0.1-draft`). `fetch('/.well-known/../docs/pseo/PILOT-MANIFEST.json')` no hub. robots Disallow `/piloto/` **não** desindexa o que já entrou.
- **test to add:** HTML canário: noindex+nofollow, **sem** canonical de produção (ou X-Robots-Tag), payload visível sem form, `n` com proveniência, handlers recusam schema `*-draft`, flag false ⇒ intake 403/404.
- **reject condition:** Muro de contato, score sem proveniência, canonical indexável, ou fixture draft usada como CTA/live.
- **rollback implication:** GSC pode reter URLs `/piloto/`. Fixtures empacotadas sobrevivem no shared data.

### PM-11-001 | high | 11 | web-cfg `inteligencia/index.html` + `data/local-entity/surface-decision.json` + `styles-hubs.css`

- **invariant:** Um hub local protótipo/noindex não é doorway. Sem city-page farm. `areaServed` nacional não vira landing municipal.
- **reproduction:** `SURFACE-DECISION.md` já proíbe farm. Hub `inteligencia/` é `noindex,follow` **com** canonical de produção e liga serviços nacionais. Campanha 11 + 10 (shells) pode re-titular rotas nacionais como “Florianópolis” sem utilidade distinta.
- **test to add:** Proto hub: noindex,nofollow, fora do sitemap, zero geração de city pages; URLs de serviço existentes não re-tituladas como locais.
- **reject condition:** Doorway, city farm, ou hub local indexável.
- **rollback implication:** Canonicals e link graph permanecem.

### PM-01-001 | high | 01 | web-cfg PRs abertas `#549`–`#522` + `package.json` + `netlify.toml` leftover scheduler

- **invariant:** Campanha 01 trata PRs antigas/deps/workflows **sem** implementar estratégia nova e **sem** segundo plano de produção.
- **reproduction:** Oito PRs abertas com `base.sha` `81c600b7…` enquanto main é `89b081a86`. Dependabot (`#524` `#523` `#522`) e PRs de copy/form (`#549` `#548`) colidem com 08/10. `RUNTIME-AUTHORITY.md` declara Netlify scheduled como leftover; `netlify.toml` ainda agenda `search-observation-tick`. `package.json` é a união de todos os `test:*` (01, 08, 10, 13). Sem CODEOWNERS.
- **test to add:** Merge de PR com merge-base ≠ `origin/main` atual falha. Jobs Netlify scheduled desabilitados no plano público. Script novo em `package.json` exige owner issue.
- **reject condition:** Merge de PR stale que altera home/form/registry/estratégia **ou** segundo scheduler.
- **rollback implication:** Restaurar `netlify.toml` reativa ticks leftover.

### PM-12-001 | medium | 12 | web-cfg `data/site/permissioned-proof-registry.json` + `/casos/`

- **invariant:** Proof/copy QA é report-only. Sem case inventado. Registry vazio permanece vazio até consentimento.
- **reproduction:** `state: NO_APPROVED_CLIENT_PROOF`, `approved_public_proof_count: 0`. `/casos/` são demonstrativos hipotéticos (`conflitos/` já o diz). Campanha 12 pode “passar QA” reclassificando demonstrativo como prova. Atalhos proibidos já listados: `fabricated_delivery`, consentimento comercial reusado como publicação.
- **test to add:** HTML público de `/casos/` contém classe `demonstrativo` até o registry ter record PUBLISHED; zero nome de cliente.
- **reject condition:** Case, nota ou selo sem record PUBLISHED no registry.
- **rollback implication:** Páginas indexadas de “prova” ficam no GSC.

### PM-13-001 | medium | 13 | web-cfg `js/modules/analytics.js` + `script.js` `UNKNOWN_SERVICE` + research pack

- **invariant:** Contrato de métrica/pesquisa **sem** emitter novo. UNKNOWN não vira serviço nem SLA. PII não entra em event.
- **reproduction:** `script.js` já emite no plano público. `nav.js` mapeia `UNKNOWN_SERVICE` para `destination_type: 'unknown'` e **ainda** dá `content_to_service`. Research pack é JSON estático; campanha 13 que toca o dicionário pode alterar `script.js`. `PII_PARAM_PATTERN` não cobre `tax_identifier_export`.
- **test to add:** Diff da 13 não modifica `js/modules/analytics.js` nem `script.js`. UNKNOWN_SERVICE não emite `content_to_service`. Events sem tax id/CNPJ/email.
- **reject condition:** Novo emitter/destino **ou** UNKNOWN coerido a serviço/SLA **ou** PII em envelope.
- **rollback implication:** Skew dicionário vs cliente (`schema_version` 1.3.0) permanece nos dados.

### PM-16-001 | high | 16 | Governance `ADMISSION-CONTROL.md` “No real declaration exists” + `delivery/fixtures/readiness-54.fail-closed.v2.json` + `CapacityLedger.release`

- **invariant:** Snapshot inicial do backlog não é autoridade live. 54 linhas UNKNOWN permanecem UNKNOWN. `RECONCILIATION_REQUIRED` continua consumindo capacidade. Teto comercial 50 ≠ staffed.
- **reproduction:** Único caminho v2 `CAN_ACCEPT` hoje é sintético (PM-06-001). `release()` permite `RECONCILIATION_REQUIRED` → `RELEASED`. Campanha 16 pode pinar o snapshot sintético ou copiar `policy_ceiling` para staffed.
- **test to add:** Inventário REAL vs SYNTHETIC; 16 não commita pin REAL sem evidência `#123`. `release` de `RECONCILIATION_REQUIRED` proibido sem `RECONCILE_RESOLVE`.
- **reject condition:** Snapshot sintético promovido a live **ou** teto copiado para staffed **ou** auto-release de ambiguidade.
- **rollback implication:** Publicar snapshot REAL é promoção; reverter arquivos só volta UNKNOWN se os consumidores relerem.

### PM-97-001 | high | 97 | shared paths: `index.html`, `form.js`, `public-family-registry.json`, `package.json`, `styles.css`, `delivery/capacity.py`, `.github/workflows/commercial-authority.yml`

- **invariant:** Integração não captura arquivos alheios (`git add -A` / `git add .` proibidos). Worktrees não compartilham artefatos mutáveis (`_site`, Blobs, sqlite, checkpoints). Um owner por path por janela. Manifesto de autoridade hasheia admission v2 **e** inbound.
- **reproduction:** Cinco superfícies nomeadas não têm CODEOWNERS. `commercial-authority.yml` roda pytest de inbound **e** capacity no mesmo job. Manifest `authority-manifest.v1.json` **não** hasheia schemas de admission v2 nem a policy inbound. extra-cli tem checkpoints in-tree (`REASON_CHECKPOINT_IN_WORKTREE`). Design gates de web-cfg ignoram `.worktrees`. `git rev-parse HEAD` sem `-C` no clone canônico devolve outra branch (falso positivo de identidade).
- **test to add:** Stage allowlist literal; `HEAD` do worktree == branch da campanha via `git -C $WT`; ledger/sqlite/checkpoints fora do repo; manifesto lista hashes inbound+admission v2; overlap de owners no mesmo path falha.
- **reject condition:** `git add -A`, arquivo fora da allowlist da campanha, worktree sujo de outro agente, ou promote com hashes divergentes.
- **rollback implication:** `git reset --hard` / `git clean -fd` são proibidos; um revert compartilhado desfaz duas campanhas.

### PM-98-001 | high | 98 | Governance `commercial/inbound/conformance.py` `ISOLATED_PASS` + Warmbly health HTTP 200 + Meetcfg refresh `ok:true`

- **invariant:** Auditoria de candidates não fecha `#65` com PASS isolado, NXDOMAIN, ou HTTP 200. Readback exige campos semânticos (`decision`, `outbound_eligible=false`, `smtp_authorized=false`, `policy_hash`).
- **reproduction:** `accepted_e2e in {PASS, ISOLATED_PASS}` conta como PASS. Fixture `live_get: NXDOMAIN`. Health inbound Warmbly **sempre** HTTP 200 com `status=READY|BLOCKED`. Meetcfg 200+`ok:true` sem producer. extra-cli recusa HTTP 200 como prova de freshness (`REASON_HTTP_200_NOT_PROOF`) — o consumidor inverte o invariante.
- **test to add:** `ISOLATED_PASS`/`LOCAL_FIXTURE_PASS` nunca closeable. 200 + body vazio / 204 / 200 sem `outbound_eligible:false` → UNKNOWN. Health `BLOCKED` não autoriza POST.
- **reject condition:** “serviço no ar” ou isolated PASS como evidência de candidate.
- **rollback implication:** Fechar `#65` não se desfaz pausando intake.

### PM-99-001 | high | 99 | web-cfg `RUNTIME-AUTHORITY.md` `storage.survives_release_rollback: true` + flags checkout + Governance overlay `UNKNOWN: PRESERVE_AND_HOLD`

- **invariant:** Promoção não apaga receipt/lead nem reabre checkout/canário/SMTP. UNKNOWN hold ≠ GO. Rollback de release troca o SHA imutável; o store compartilhado permanece.
- **reproduction:** Rollback de `_site` preserva `/var/lib/confenge-web`. HTML velho + leads novos, ou HTML novo + `flags.json` de SHA antigo, pode reabrir checkout (`flags.json` hoje false; `piloto-checkout-decision.v1.json` VALIDATE). Overlay `PRESERVE_AND_HOLD` combinado com `CAN_ACCEPT` sintético vira GO nas mãos de um consumidor. Pause de intake **repete** ACCEPTED já gravados; store inbound é MODEL_ONLY (claim `receipts_retained` sem ledger durável neste repo).
- **test to add:** Fixture de rollback: store de leads intacto; `production_checkout_enabled` não vira true via SHA antigo se a decisão continua VALIDATE; overlay UNKNOWN não seta `new_admission_allowed`.
- **reject condition:** Perda de recibo/lead **ou** reabertura de checkout/SMTP/canário **ou** promote em cima de CAN_ACCEPT sintético/isolated PASS.
- **rollback implication:** Este **é** o path de rollback. Delete de store é proibido. Pause não un-accept.

### PM-08-002 | high | 08 | web-cfg `js/modules/form.js` `finishOk` `?receipt=` + FormData completo + `diagnostico-b2g-expansao` `name="cnpj"`

- **invariant:** PII de processo, saúde, empregados, planta ou conflito não entra em URL/event/log. Recibo opaco na query ainda vaza via Referer.
- **reproduction:** Sucesso navega `dest + '?receipt='`. Form copia todas as chaves FormData (CNPJ em várias money pages). WhatsApp float pré-preenche texto. Campanha 08 multi-vertical pode adicionar campos de perícia/SST/planta no mesmo runtime.
- **test to add:** `location.search` / analytics / `safeLog` sem email/cnpj/tax_identifier/mensagem. Novos campos de saúde/processo/planta recusados no schema do lead.
- **reject condition:** Qualquer chave PII sensível em URL/event/log **ou** campo novo fora do allowlist.
- **rollback implication:** Query logs, access logs e threads WA não revertem com git.

### PM-07-002 | medium | 07 | warmbly `internal/api/handler/confenge_inbound.go` `ConfengeInboundHealth` + POST 201 `data` com email/raw payload

- **invariant:** Health 200 + `status=BLOCKED` não é READY. 201 de persistência não é aceite humano nem watch delivered. Readback HTTP não ecoa PII.
- **reproduction:** GET health sempre `http.StatusOK`. POST 201 inclui `LeadEmail`/`RawPayload`/`Context`. Enrichment FAILED ainda 2xx. Query PII é rejeitada; body não.
- **test to add:** Cliente web-cfg lê `status`/`real_event_ready`, não o código HTTP. Webhook `data` = metrics view. FAILED ≠ pipeline-ready.
- **reject condition:** POST inbound autorizado só porque health foi 200, ou 201 tratado como readback completo.
- **rollback implication:** `raw_payload` permanece no Postgres.

### PM-XCLI-001 | medium | 97 | extra-cli `docs/contracts/confenge-commercial-plane/v1/operating-authority.json` + checkpoints in-tree

- **invariant:** extra-cli é evidência de apoio, não owner da matriz. HTTP 200 não prova freshness. Checkpoints de worktree não são autoridade.
- **reproduction:** Plano comercial pinado (#543). Freshness gate já tem `REASON_HTTP_200_NOT_PROOF` e `REASON_CHECKPOINT_IN_WORKTREE`. Dois worktrees extra-cli no mesmo clone compartilham artifacts/.
- **test to add:** 97 não commita checkpoints; meetcfg `ok` iff ≥1 item ACCEPTED do produtor.
- **reject condition:** Checkpoint in-tree como pin de promote **ou** 200 extra-cli como admissão comercial.
- **rollback implication:** Artifacts/ no repo sobrevivem.

---

## Blockers atuais que não pertencem a nenhuma campanha da matriz

Não implementar. Não abrir dezenas de tickets. Owner sugerido:

| Blocker | Owner sugerido |
| --- | --- |
| Honeypot/lead 200 já em produção (`PM-08-001`) | web-cfg runtime / issue de captura (`#61` no contrato inbound; `#580` triagem) |
| Pin Governance em web-cfg SHA `e2b0498a` / PR 9, stale | owner do pin `data/offers/governance-authority-pin.json` + Governance `#1` |
| Sem CODEOWNERS nas superfícies compartilhadas | fundador / 97 (processo), não um ticket por arquivo |
| `#65` OPEN com policy ACTIVE e `SCHEMA_MISMATCH_COLLECTION` | Warmbly `#47` + Governance `#65`; 98 audita, 99 não fecha |
| Sem snapshot staffed REAL (`#123`); 54/54 UNKNOWN (`#122`) | delivery owner; 16 registra, não inventa |
| Netlify scheduled leftover vs autoridade Netcup/Cloudflare | runtime `RUNTIME-AUTHORITY.md` |
| Gates de design/a11y ignoram `.worktrees` | quality / story `#599` |
| Overlay `UNKNOWN → PRESERVE_AND_HOLD` vs delivery UNKNOWN fail-closed | 97 (comercial vs delivery), não um ticket novo |
| Meetcfg `WARMBLY_PRODUCER_SHA` ≠ Warmbly main | Meetcfg consumer owner |

## Mapa das 14 perguntas adversariais → findings

| Pergunta | Findings |
| --- | --- |
| Fachada sem utilidade privada | PM-10-001 |
| Taxonomia como segunda SoT | PM-02-001, PM-03-001 |
| Draft como runtime | PM-09-001, PM-14-001, PM-03-001 |
| Dois owners em home/form/registry/package.json/CSS | PM-10-001, PM-97-001, matriz de ownership |
| PII em URL/event/log | PM-08-002, PM-05-001, PM-07-002 |
| UNKNOWN coerido | PM-06-001, PM-14-001, PM-13-001, PM-16-001 |
| B2G perde URL/canonical/link/intent | PM-10-001 |
| Credencial → endorsement/storefront/ART | PM-04-001, PM-03-001 |
| Canário com muro de contato ou score enganoso | PM-09-001 |
| Hub local doorway | PM-11-001 |
| Inbound herda outbound | PM-07-001, PM-14-001 |
| HTTP 2xx = aceite/readback | PM-08-001, PM-07-002, PM-14-001, PM-98-001 |
| Rollback apaga recibo ou reabre risco | PM-99-001, PM-16-001 |
| Worktrees compartilham artefatos / capturam arquivos alheios | PM-97-001, PM-XCLI-001 |

## Caveats (não remover)

1. Este documento inspeciona **main contemporâneo**. PRs das campanhas 01–14/16/97–99 **não existiam** (ou não foram lidas como review) no momento da inspeção.
2. Várias defesas **já existem** e não foram apagadas da análise: family registry fail-closed, checkout flags off, piloto Disallow, `analise-cnpj` sem CNPJ na URL de resultado, inbound `CONFENGE_AUTO_SEND_ENABLED=false`, constraint SQL `inbound_only_not_outbound`, Meetcfg fail-closed em collection vs dossier, extra-cli `HTTP_200_NOT_PROOF`, admission v2 UNKNOWN fail-closed na documentação, store de leads que sobrevive rollback (feature e risco ao mesmo tempo).
3. `lead.cjs` no path de create **é** 201; o furo vivo é **aceitação de 200 no cliente** + honeypot.
4. Storage que sobrevive rollback preserva leads **e** pode reabrir flags velhas.
5. Policy inbound ACTIVE em Governance ≠ `#65` fechada ≠ Warmbly pinado.
6. `CAN_ACCEPT` sintético com `promise_allowed=false` é fixture de prova, não vaga vendável — a menos que um consumidor ignore `promise_allowed`.
7. Worktree de escrita desta campanha foi revalidado com `git -C $WT`; `HEAD` sem `-C` no clone canônico aponta outra branch e **não** é evidência de sujeira deste worktree.
8. Não houve merge, deploy, SMTP, mutação de provider ou produção nesta campanha.

## Entregas irmãs

- `acceptance-test-manifest.json` — testes de aceite **e** negativos por campanha, com `reject_condition`, para o goal 97.
- `ownership-conflict-matrix.json` — lock das superfícies nomeadas e correlatas.
- `final-red-team-checklist.md` — gate de rejeição, não narrativa de sucesso.
