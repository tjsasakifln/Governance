# CONFENGE-TERMINAL-CONVERGENCE-AND-PRODUCTION-CLOSURE-01

Data: 2026-09-15 (America/Sao_Paulo). Coordenador único: sessão Claude Code (ultracode), host único de produção `ec-prod` (159.195.18.88). Todos os SHAs abaixo foram lidos de produção após cada deploy, não inferidos do CI.

## 1. Executive verdict

CONFENGE_TECHNICAL_CONVERGENCE=PROVEN (residuais comerciais explicitamente gated, ver §23). Os quatro planos rodam em produção exatamente o HEAD contemporâneo de cada repositório no momento do readback, provado por leitura independente. O probe de produção é somente leitura por contrato, por teste e por rastreio de rede contra a produção real. Uma pessoa válida sem contexto comercial completo é persistida com `NEEDS_CONTEXT` (provado em produção com um canário sintético persist-only). O Control Center e a autoridade Governance descrevem o que está publicado hoje. Três itens dependem de decisão humana e estão levados ao gate exato (checkpoint #468 para os dois ciclos, ratificação FINAL do pin do intake adaptativo, credenciais para o cutover do adaptador Asaas). SMTP continua NO_GO, dispatch pausado, `SMTP_DELTA=0` em todas as operações desta campanha.

## 2. Before state (Fase 0, 2026-09-15 ~10:00 -03)

| Plano | origin/main | Produção | Match |
|---|---|---|---|
| web-cfg | 1ddc5c1e | build-info.commit 1ddc5c1e; current -> releases/1ddc5c1e | TRUE |
| extra-cli | b894d7dd | drop-ins pinados em /opt/extra-consultoria-releases/b894d7dd; timers comerciais pausados; contact-cycle e feed-cycle em `failed` (05/09, release e9858a14, "target-fit national coverage is incomplete") | TRUE (release) |
| warmbly | c003ea59 | imagens fafa8bda (1 commit atrás, #270 só nginx); checkout do host já em c003ea59; `.env` com WARMBLY_RELEASE_SHA stale (3368e7d8); kill-switch de volume ausente (up.sh sobrescrevia/limpava); espelho de host stale; admin exposto em 0.0.0.0:5174; adaptador Asaas versionado nunca ativado (legado server.py:18081 vivo) | FALSE |
| Governance/CC | 0074722c | Control Center 5fdda4f1 (15 commits atrás: NET_NEW_INBOUND_HANDRAISER-v1 #166/#167/#171, ACQUISITION_PRESSURE #164/#165, MV-03 #172) | FALSE |

Baseline comercial: `confenge_dispatch_sends=94` (último 2026-09-02), `dispatch_control.paused=t` (operator_keep_paused_for_261), `MAIL_TRANSPORT=log`, `AUTO_SEND=false`, `GREEN_AUTORUN=false`, `REQUIRE_HUMAN_APPROVAL=true`; feed extra publicado em 2026-08-13 (401.923 leads, 402 chunks), autoridade do feed expirada em 2026-09-04; inbound_leads=25; intel_watch_inbox=1.

Checkouts locais sujos (nunca usados; snapshots em phase0/dirty): extra-cli detached 3919f4d9 (rotulado `wip/detached-3919f4d-20260915`), Governance feat/120 com 11,9k linhas de diff, warmbly feat/confenge-sales-context-export.

## 3. Root causes

1. **Probe de produção mutável (A1)**: `money_asset_prod_proof.mjs` fazia 2 POST em `/.netlify/functions/lead` (captura + replay), XFF aleatório, relatório 0644, sem timeout; docstring dizia "nunca cruza para o Warmbly" enquanto o código transportava sintéticos autenticados sincronamente. Job diário `revops daily-ops` falhando desde 2026-08-24 por Turnstile obrigatório no perfil Netcup.
2. **Perda de intenção (B)**: `lead-core.cjs` recusava com 422 antes da persistência lacunas de licitação/produto/contrato e 400 na ausência de `estagio`; `contract_stage` `required` no gerador dos produtos de defesa de contrato; CNPJ inválido passava a ser persistido no caminho de lacuna (achado da revisão adversarial, corrigido antes do merge).
3. **Readback de release do extra-cli quebrado (F)**: `pin_release.verify()` consultava o template `extra-contact-discovery-worker@.service` diretamente (systemd rc≠0, saída vazia, `check=False` engolia) — #575 resolve com instância sintética `@pin-readback` inativa.
4. **Deploy do warmbly destruía pausa de operador (H)**: `up.sh` passo 4 sobrescrevia o kill-switch incondicionalmente e o passo 8 o apagava; o ramo "held" era inalcançável; a pausa repousava só na linha do DB.
5. **Control Center 15 commits atrás e falsos zeros (K)**: superfícies opcionais ausentes viravam `0` (`?? 0`, `.length`), `auto_send` "desligado" sem observação, "leitura veio limpa" com contagem não observada.
6. **Docs de autoridade divergentes (J)**: CONSUMER-CONTRACT/HANDOFF apontavam v1 (rejeitado pelo avaliador) enquanto Warmbly e o pin real usam `1.0.0-draft.20260904` (hash 405ac860…); sem registro machine-readable de qual versão é alvo de pin.
7. **Supply-chain (ambiental)**: CVEs novos (js-yaml, next, sharp, grpc, astro, tiptap, smol-toml, svgo, libpcre2) deixaram vermelhos checks obrigatórios do warmbly e o scan de imagens do Governance — corrigidos por bump/rebuild, sem exceções.
8. **Persist-only deixava PENDING (achado pós-deploy)**: o caminho persist-only do probe autenticado não gravava estado terminal; o drain diário transportaria o sintético (PR #690).
9. **Disco**: 88% usado (52 releases imutáveis do extra-cli = 28 GB; imagens Docker superadas) — `release-deploy.sh` recusou fail-closed até haver folga.

## 4. Fixes by repository

**web-cfg** (PR #689, merge f40e2125e; PR #690): probe GET/HEAD-only com timeout e relatório 0600 + `test:ativacao-01` no site-ci; inventário `docs/ops/PRODUCTION-PROBE-INVENTORY.md` com teste fail-closed; XFF aleatório removido; `audit_commercial_dod` POST live opt-in; `lead-core.cjs` recebe-antes-de-qualificar (`NEEDS_CONTEXT` + `qualification_gaps[]`, `estagio` default canônico, CNPJ só validado, `field` no erro 400); `contract_stage` opcional no gerador; hand-raise atrás do canary fail-closed; `test:runtime-authority` e step de inspeção pinados no site-ci; evidência de primeira dobra re-medida (Chrome headless); build outputs regenerados; persist-only terminal + drain nunca transporta sintético autenticado.

**extra-cli** (#575 → 98b9e331): readback de template via instância sintética inativa.

**warmbly** (PR #272 → 55ed2883): `up.sh` sonda tri-estado do kill-switch (present/absent/indeterminate), nunca sobrescreve pausa de operador, recusa em sonda indeterminada, nunca toca no espelho; supply-chain (grpc 1.83.2, js-yaml 4.3.2, next 16.3.3, sharp 0.35.4, astro 7.3.2, smol-toml 1.7.1, svgo 4.1.0, @tiptap 3.31.3); `.trivyignore` só com remoções.

**Governance** (PR #173 → 694e6915): docs de consumidor apontam o alvo de pin único; `commercial/inbound/pin-registry.v1.json` com hashes computados + pytest (um PIN_TARGET por policy_id); `authority-manifest` regenerado (AUTHORITY_HASH sha256:61648c48a599e6a6db558fd844b7fc7b6c36e066cf52af10126e3544c058398e); Control Center: ausência ≠ 0, "não observado", "leitura parcial"; vhosts nginx efetivos versionados (auth rate-limit, -http ACME/301); orçamento de JS recuperado (406532→403982 raw, sem tocar no budget); imagens com libpcre2 deb12u1 e Caddy com grpc 1.83.2.

## 5–7. PRs, merge SHAs e SHAs de produção

| Repo | PR | Merge SHA (main) | Produção (readback) |
|---|---|---|---|
| web-cfg | #689, #690 (merge commits) | dce15f9e60a184fea14598448d0c6d559a228c3a | build-info/runtime-info/edge/origin/host = dce15f9e6; bundle 517fb59b… atestado (f40e2125e foi o passo intermediário, agora rollback symlink) |
| web-cfg | #690 | (ver seção 16 — promoção após CI) | idem |
| extra-cli | #575 (rebase) | 98b9e331ab8f952294de01860e245e2a61cd2a26 | drop-ins + PYTHONPATH dos processos = 98b9e331; pin verify ok:true |
| warmbly | #271 (rebase), #272 (rebase) | 55ed2883b579d573163c6192b3550da4537a9a07 | backend/consumer/worker imagem+env+audit = 55ed2883 |
| Governance | #173 (merge commit) | 694e6915ff2020e92c98601f32f6d116703d7815 | web/mcp/context/collector = 694e6915; verify-release PASSED |

## 8. Migrations
Nenhuma nova. warmbly `schema_migrations=145 dirty=false` antes e depois; extra-cli sem migration em #575; CC sem schema change.

## 9–10. Production deployment evidence e readbacks
- **web**: netcup-release run 35009688981: preflight → site-ci/pSEO no SHA exato → package+attestation → stage+host verify → pre-promotion qualification → atomic promote; `NETCUP_ACCEPTANCE_TERMINAL_STATE promoted=success served_coverage=success runtime_acceptance=success lighthouse=MEASURED_PASS`. Readback: borda Cloudflare, origem 443 via loopback e Node 18100 concordam em f40e2125e; home sha256 f4db3c55… idêntico em borda/origem/`_site/index.html`; `/_headers /_redirects /.env /package.json /.git/HEAD /deploy/... /seo/PUBLIC-ARTIFACT-MANIFEST.json` → 404; robots 2303 B (bloco gerido + origem); `lead` GET 405; rollback -> 1ddc5c1e.
- **extra**: `cut_release.sh 98b9e331 --preserve-timer-state` → drop-ins reescritos, `verification.ok=true`, drift vazio; serviços habilitados reiniciados; `@pin-readback` inactive/disabled; timers continuam disabled/inactive; mutex EMPTY; artifact binding PASS (`protected_changed=[]`, bound 09e122d3 ancestral); plano comercial PASS com `HOST_ONSUCCESS_COUPLING=ZERO`; backup dos drop-ins em /root/campaign-tc01.
- **warmbly**: backup pré-deploy (warmbly-confenge-20260915T193712Z.tar.gz + manifest v2 + sha256); `release-deploy.sh 55ed2883` (primeira tentativa recusada por disco; após reclaim: pull das imagens pinadas, recriação, verify-release OK ×3, retenção); health/ready 200; `pause.sh operator_keep_paused_for_261` re-engajado (volume + espelho + governor 200); admin recriado pelo perfil do pack → `127.0.0.1:5174`; nginx -t OK; adaptador Asaas legado READY (untouched).
- **Control Center**: `deploy-release.sh 694e6915` → RELEASE VERIFICATION PASSED, receipt release-receipt-20260915T191419Z-694e6915…; loopback healthz 200; público `/ready` e `/mcp` 404; cockpit 302 → Authelia.

## 11. Adversarial review findings (fechados antes do merge)
- HIGH web-cfg: CNPJ inválido persistido no caminho de lacuna → só CNPJ validado; teste `priced_model_gap_keeps_only_validated_cnpj`.
- HIGH warmbly: sonda indeterminada colapsava em "ausente" → tri-estado, REFUSE exit 6.
- HIGH web-cfg (rodada 2): exceções obsoletas em `runtime-authority-scan.json` → removidas (30/0).
- MED: required-step não pinado; datas sem razão de lacuna → `qualification_gaps` persistido; mirror rm destrutivo removido; ausência de superfície em contagens derivadas de lista; assert vazio de funil; `hoje-compose` "veio limpa".
- Achado pós-deploy: persist-only PENDING (PR #690).

## 12. Mutation proofs (cada correção revertida isoladamente → teste vermelho)
lead-core.cjs 832/834/836/855/902/1147/1377; lead.cjs 150; intake-core.cjs 249-260; money_asset_prod_proof.mjs (versão POST); audit_commercial_dod.mjs 95/169; site-ci.yml 214-217/409 (após pin); inventário; up.sh 133/146/217/223-226 (+ docker rc 125); normalize.ts/commercial.ts/assemble.ts/domains.ts/hoje-compose.ts (10 alvos); pin-registry (6); nginx conf (7); pin_release.py 322-324 (#575); lead.cjs 457-466 e inbound-handoff.cjs 1350 (#690).

## 13–14. Extra cycle 1 / cycle 2
NÃO EXECUTADOS — gate humano G1. Pré-condições provadas: release 98b9e331 pinada e verificada; mutex único (sessão A ACTIVE + B/C recusadas exit 75 antes de mutação); binding PASS; targeting truth PASS (0 Sistema S em TARGET_CONFIRMED de 7.927; 569 hard-outs parafiscais; 5 falsos alarmes textuais são construtoras cujo objeto cita prédio SESC/SENAI); `target_fit_coverage` em produção: coverage_ratio=1.0, FULLY_RECONCILED, FULL_NATIONAL_READY, pagination_exhausted_normally=true (2026-09-06 04:03Z) — a causa do abort de 05/09 não está mais presente. Comandos canônicos: `systemctl start extra-confenge-target-fit-refresh.service` → `extra-confenge-target-fit-reconcile.service` → `extra-confenge-contact-cycle.service` → `extra-confenge-feed-cycle.service` (timers permanecem pausados; cada um sob o mutex com operation_id próprio).

## 15. Inbound receipt/readback proof
Canário sintético persist-only autenticado (nome SYNTHETIC-INBOUND TC01, e-mail example.com, `test_mode`, `record_kind=synthetic`, sem `estagio`, mensagem "tenho urgência e quero falar, mas ainda não tenho todos os dados"): 201, `lead_id=receipt_id=lead-883a5d12f6c47a26096707cff76`, `qualification_state=NEEDS_CONTEXT`, `qualification_gaps=[estagio_unknown_service]`, `estagio="ainda não sei qual serviço"`, `record_kind=synthetic`, `next_action=exclude_from_commercial`, sem handoff; replay 200 idempotente mesmo lead_id. Warmbly público: inbound health READY (`auto_send_enabled=false`); readback assinado HMAC do canário MV-09 (`nihr:web:mv09-accepted-1788664259`) → 200 `outcome=ACCEPTED outbound_eligible=false auto_send=false replay=false policy_version=1.0.0-draft.20260904`; sem assinatura 401; POST 403; query 400. Intake adaptativo: 503 `intake_unavailable` (WITHHELD honesto, fail-closed) com canais diretos funcionais em /triagem-tecnica/ (WhatsApp, e-mail, telefone).

## 15b. Persist-only guard proven on dce15f9e6 (PR #690)
Promoção 1 de dce15f9e6 foi bloqueada pelo guard de toolchain (qualificação chrome 153.0.8010.36 ≠ verificação .47, rollout de imagem do runner entre jobs) — nada promovido; rerun completo promoveu (attempt 2). Readback: borda `build-info.commit=dce15f9e6`, origem (loopback 443) `dce15f9e6`, runtime node `release_sha=dce15f9e6` bundle 517fb59b…, home byte-idêntica borda/origem (f4db3c55…), rollback symlink → f40e2125e. Canário novo persist-only `lead-2897d71013d9aaaa4e9357970c7`: 201 NEEDS_CONTEXT, replay 200 idempotente, registro `persist_only_probe=true`, `handoff={SKIPPED, persist_only_probe, next_attempt_at=null}`, journal `handoff:"SKIPPED"` + `synthetic_probe_persist_only`. Registro legado `lead-883a5d12f6c47a26096707cff76` (persistido PENDING antes do guard): único registro devido no store (PENDING 1 / DELIVERED 3 / SKIPPED 4 / BLOCKED 1); `ops drain_inbound limit=1` autenticado → `attempted=0 delivered=0 skipped=1`, registro agora `SKIPPED/synthetic_probe_not_drained`, journal `inbound_handoff_synthetic_not_drained previous_status=PENDING`. Nenhum registro sintético foi transportado ao Warmbly em nenhum momento.

## 16. Web exact-artifact proof
Ver 9–10. Lighthouse na borda pós-promoção: home ×3 perf 100, p75 TBT 4 ms, LCP máx. 1775 ms (líquido 1559), + rota runtime /oportunidades/… perf 100. Probe read-only contra produção: 2 GET, 0 não-GET, relatório 0600, `page_live=PROVEN`, `indexability_hygiene=PROVEN`, captura/transporte `NOT_VERIFIED` por contrato.

## 17. Warmbly runtime/pack proof
Ver 9–10. Drift que permanece (gate G3): adaptador Asaas versionado (adapter.py:8791) nunca ativado; nginx efetivo proxya `/api/v1/webhooks/asaas*` → 127.0.0.1:18081 (server.py legado, READY, order-to-cash intacto); `status.sh` marca `ASAAS ADAPTER FAIL` por esperar o versionado. Não aplicado por design: `asaas-adapter-install.sh` ou `inbound-edge-install.sh` isolados quebrariam o webhook vivo. Restore smoke: backup de hoje restaurado em Postgres descartável, schema 145, contagens restauradas == vivas (sends 94, inbound_leads 25, first_touch_batches 49139, paused=true), adaptador vivo intocado.

## 18. Governance/Control Center proof
Cadeia de autoridade: Governance `NET_NEW_INBOUND_HANDRAISER/1.0.0-draft.20260904` hash sha256:405ac860… source_sha 0074722c (registro pin-registry.v1.json, único PIN_TARGET) ⇄ Warmbly const pins (mesmo hash/SHA; readback público responde `policy_version 1.0.0-draft.20260904`) ⇄ web-cfg WITHHELD (pin null) — MATCH onde há pin; web-cfg fail-closed por design até G2. CC em 694e6915 com absence≠0 e auto_send "não observado". `ACQUISITION_PRESSURE.reached`: ABSENT (sem produtor em web-cfg; GSC BLOCKED_EXTERNAL #413) — mantido UNKNOWN, nunca 0.

## 19. Open external residuals
G1 checkpoint #468; G2 pin FINAL; G3 Asaas cutover (token/secret); `ACQUISITION_PRESSURE.reached` (web-cfg #61/#563, depende de GSC #413); INTEL_WATCH producer (`deliver_pending_events`) sem scheduler/CLI e sem prova e2e — `CONFENGE_OPPORTUNITY_EVENT/1.0` aceito pelo inbound health, inbox=1; nucleus_id null nos leads não adaptativos; deals/tasks/contacts 200-não-lista → 0 no CC (CONTRACT_DRIFT follow-up); warmbly `DELEGATED_FIRST_TOUCH_AUTORUN` acumulando APPROVED/QUEUED com transporte pausado (PARTIAL 35.378 / APPLIED 13.761) — decisão antes de qualquer resume; canário MV-09 ACCEPTED persistido no store comercial sem decisão de retenção; timer de backup do warmbly inexistente (backup manual hoje); warmbly TestPG* não executam no CI; `netcup_inbound_harness` modo persist-only não prova transporte; ops health não autenticado em /.netlify/functions/ops; HEAD /robots.txt content-length ≠ GET (borda); `https://confenge.com.br/ready` responde 200 com JSON de readiness do runtime web (18100) na superfície pública — não é o Control Center (cujo ops-host responde 404), registrado como fato, sem ação implicada.

## 20. Closed/superseded issues and PRs
web-cfg fechadas: #682 e #636 (superseded por #689), #639, #632, #631, #630, #629, #628, #627, #614, #609 (superseded), #593 (not planned); comentadas STILL_REQUIRED #637, #635; BLOCKED_EXTERNAL #633, #600. extra-cli fechadas: #555–#564 (superseded por #572); comentadas #572, #568, #569, #557, #531. warmbly: #271 e #272 mergeadas; #267/#269 BLOCKED_EXTERNAL. Governance: #168/#169 fechadas (not planned); #173 mergeada.

## 21. Rollback instructions
- web: `deploy/netcup/run_bundle_control.py --operation rollback --rollback-target f40e2125e46d1bce2361352cffce4a4205d425e8` (symlink rollback aponta para f40e2125e; 1ddc5c1e permanece em /opt/confenge-web/releases).
- extra: `pin_release.py b894d7ddf445d81411d8d46701734d2630b27878 --preserve-timer-state` a partir de /opt/extra-consultoria-releases/b894d7dd (release mantida); backup dos drop-ins em /root/campaign-tc01/*.service.d.
- warmbly: `release-deploy.sh fafa8bda803c5245368dc4261fe8eb223c5c4dba` (imagens mantidas); backup 20260915T193712Z; `pause.sh` continua engajado.
- CC: `deploy-release.sh` recusa rollback por SHA; usar o receipt de rollback-point (imagens 694e6915 e 5fdda4f1 mantidas; rollback-point-20260915T222308Z) conforme PRODUCTION-RUNBOOK §Rollback.

## 22. Production acceptance matrix (final)
| Plano | Main SHA | Deployed SHA (readback independente) | Match | Prova |
|---|---|---|---|---|
| web-cfg | dce15f9e6 | dce15f9e6 (`/.well-known/build-info.json` + `runtime-info.json` + origem loopback + host symlink) | TRUE | bundle 517fb59b… atestado SLSA; home byte-idêntica borda/origem; edge Lighthouse MEASURED_PASS (attempt 2); arquivos de controle 404; guard persist-only provado ao vivo |
| extra-cli | 98b9e331 | 98b9e331 (drop-ins `90-immutable-release.conf` + `pin_release.py --verify-only`) | TRUE | mutex A ACTIVE / B,C exit 75; binding PASS; commercial plane PASS coupling ZERO; targeting truth PASS |
| warmbly | 55ed2883 | 55ed2883 (`verify-release`, imagens ghcr por SHA) | TRUE | schema 145; sends 94→94; paused=t; readback assinado 200 na borda; restore smoke PASS |
| Governance / Control Center | 2936c55 | 2936c55 (`deploy-release.sh` GO:CONTROL_CENTER_RELEASE_CONVERGED, RELEASE VERIFICATION PASSED, imagens `:2936c555…`) | TRUE | /ready e /mcp públicos 404; authority manifest hash 61648c48…; pin-registry único PIN_TARGET |

Estados sem PASS inventado: `ACQUISITION_PRESSURE.reached`=UNKNOWN (ABSENT, não 0); INTEL_WATCH e2e=NOT_PROVEN; lane adaptativa=WITHHELD (503 honesto); ciclos C1/C2=NOT_RUN_HUMAN_GATE; Asaas versionado=NEVER_ACTIVATED (legado vivo).

## 23. Terminal verdict
FINAL_VERDICT=CONFENGE_TECHNICAL_CONVERGENCE=PROVEN
WEB_MAIN_SHA=dce15f9e6
WEB_DEPLOYED_SHA=dce15f9e6
WEB_SHA_MATCH=TRUE
EXTRA_MAIN_SHA=98b9e331
EXTRA_DEPLOYED_SHA=98b9e331
EXTRA_SHA_MATCH=TRUE
WARMBLY_MAIN_SHA=55ed2883
WARMBLY_DEPLOYED_SHA=55ed2883
WARMBLY_SHA_MATCH=TRUE
GOVERNANCE_MAIN_SHA=2936c55
CONTROL_CENTER_SHA=2936c55
CONTROL_CENTER_SHA_MATCH=TRUE
GOVERNANCE_AUTHORITY=MATCH
WEB=CURRENT_AND_VERIFIED
INBOUND=HONESTLY_WITHHELD_WITH_FUNCTIONAL_DIRECT_CHANNELS
INBOUND_CLASSIC_LANE=PERSIST_FIRST_PROVEN
SYNTHETIC_PROBE_TRANSPORT=NEVER_TRANSPORTED_GUARD_PROVEN_LIVE
EXTRA_COMMERCIAL_CHAIN=READY_GATED_ON_CHECKPOINT
CYCLE_1_STATUS=NOT_RUN_HUMAN_GATE
CYCLE_2_STATUS=NOT_RUN_HUMAN_GATE
OUTBOUND_POPULATION=NOT_RECOVERED_PENDING_CYCLES
OUTBOUND_TRANSPORT=NO_GO_SMTP
SMTP_CURRENT_VERDICT=NO_GO
WARMBLY_RUNTIME=CONVERGED_WITH_ASAAS_DRIFT_GATED
NGINX_PACK_DRIFT=PRESENT_GATED_G3
CONTROL_CENTER=CURRENT
ACQUISITION_PRESSURE_REACHED=UNKNOWN
INTEL_WATCH_E2E=NOT_PROVEN
COMMERCIAL_EVIDENCE=NOT_YET_OBSERVED
REAL_QCO_OBSERVED=NOT_YET_OBSERVED
REAL_PROPOSAL_OBSERVED=NOT_OBSERVED
REAL_REVENUE_OBSERVED=NOT_OBSERVED
REPORT_COMMIT_NOTE=este relatório entrou em Governance pela PR #174 (merge 2936c55, docs-only) e o Control Center foi reimplantado e verificado em 2936c55 (readback no comentário da PR). Os SHAs acima registram o HEAD no qual o CC foi verificado, não o SHA da edição final deste arquivo; esta correção de valores é docs-only e NÃO dispara nova reimplantação do CC — um HEAD de Governance um commit docs-only à frente do CC não é drift de autoridade (authority manifest inalterado).
FOUNDER_ACTION_REQUIRED=
  G1 (extra-cli #468): autorizar no issue a execução do Ciclo 1 sobre o release 98b9e331 (comentário de checkpoint publicado 2026-09-15).
  G2 (Governance): ratificar `NET_NEW_INBOUND_HANDRAISER` como FINAL (sair de draft.20260904) e fornecer os env pins ao runtime Netcup — só então a lane adaptativa sai de WITHHELD.
  G3 (warmbly): fornecer token/secret do Asaas versionado e agendar cutover `18081 legado → adapter.py` com janela e rollback; até lá `status.sh` reporta ASAAS ADAPTER FAIL por design.
  G4 (warmbly #43): NÃO executar `resume.sh` — o backlog DELEGATED_FIRST_TOUCH_AUTORUN (35.378 PARTIAL / 13.761 APPLIED) drenaria na janela de envio; `MAIL_TRANSPORT=log` é a única barreira. Decisão de retenção/expurgo desse backlog precede qualquer troca de transporte.
