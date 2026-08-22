# Runbook — colocar o primeiro cohort real de e-mail em operação

Estado em 2026-08-22. Este documento cobre **apenas o que exige ação humana fora
do terminal**. Tudo o que podia ser automatizado já foi.

Próxima janela comercial válida: **segunda-feira, 24/08/2026, 09:00 America/São_Paulo**
(`next_slot_at=2026-08-24T12:00:00Z`, lido ao vivo do Warmbly em produção).

---

## Bloqueio 1 — DKIM ausente no domínio de envio

**Verificado, não presumido.** Sondei 22 selectors contra `1.1.1.1` e `8.8.8.8`,
incluindo os 14 que o próprio checker do Warmbly conhece
(`dnsauth.go:59: defaultSelectors`) e os três da Hostinger
(`hostingermail1/2/3`). Nenhum resolve.

| Registro | Estado | Valor observado |
|---|---|---|
| SPF | **PASS** | `v=spf1 include:_spf.mail.hostinger.com ~all` |
| DMARC | **PASS** (presente) | `v=DMARC1; p=none` |
| DKIM | **AUSENTE** | nenhum selector resolve |
| MX | ok | `mx1/mx2.hostinger.com` |

Detalhe que muda o procedimento: **o DNS de `confenge.com.br` está na Cloudflare**
(`grannbo.ns.cloudflare.com`, `kai.ns.cloudflare.com`), não na Hostinger. Então a
Hostinger **gera** a chave, mas quem **publica** o registro é a Cloudflare.

### Passo a passo

1. hPanel da Hostinger → **E-mails** → `confenge.com.br` → **Configurações de e-mail**
   → **DKIM**. Se estiver desabilitado, habilite.
2. A Hostinger mostrará um registro TXT, tipicamente:
   - Nome: `hostingermail1._domainkey`
   - Valor: `v=DKIM1; k=rsa; p=MIIBIjANBg...`
3. Cloudflare → zona `confenge.com.br` → **DNS** → **Add record**:
   - Type `TXT`, Name `hostingermail1._domainkey`, Content = o valor do passo 2,
     Proxy **DNS only**, TTL Auto.
4. Se a Hostinger mostrar `hostingermail2` / `hostingermail3`, publique os três.

### Por que não fiz por você

Tentei, com browser real (Playwright em container no `ec-prod`). O hPanel está
atrás do desafio anti-bot da Cloudflare — a página devolve "Executando verificação
de segurança / proteção contra bots maliciosos" antes de qualquer formulário de
login. Não vou tentar contornar um controle anti-automação de terceiro, então
esse passo é seu. As credenciais que você passou foram usadas só para provar
SMTP/IMAP e removidas do host em seguida.

### Quanto isso realmente bloqueia

Menos do que parece. O gate do próprio Warmbly (PR #160) exige **SPF presente e
DMARC presente** — que já passam — e deliberadamente **não** exige DKIM, porque
selectors não são descobríveis por DNS. Então o sistema não te barra. O que a
ausência de DKIM custa é reputação de entrega: sem assinatura, provedores
destinatários avaliam só SPF, e um cold outbound institucional fica mais exposto
a spam folder.

Minha leitura: **vale publicar antes de segunda**, mas não é o que impede o
sistema de operar.

### Como eu confirmo

Me avise e eu rodo a verificação real. Ou você mesmo:

```bash
python3 - <<'PY'
import dns.resolver
r=dns.resolver.Resolver(configure=False); r.nameservers=["1.1.1.1"]
for s in ("hostingermail1","hostingermail2","hostingermail3"):
    try: print(s, [x.to_text()[:60] for x in r.resolve(f"{s}._domainkey.confenge.com.br","TXT")])
    except Exception as e: print(s, type(e).__name__)
PY
```

> **Não vou declarar DKIM PASS sem esse registro resolvendo.** Um probe corrigido
> não é DKIM configurado.

---

## ~~Bloqueio 2~~ — RESOLVIDO: SMTP/IMAP já estava configurado

**Eu estava errado.** Inferi "não configurado" das env vars vazias, mas a fonte de
verdade é a tabela `email_accounts` no Postgres do Warmbly, onde há uma conta
`smtp_imap` ativa para `tiago.sasaki@confenge.com.br` com host, user e senha
cifrados. As env vars vazias são o comportamento esperado — elas são override.

O preflight do próprio Warmbly em produção:

```
[ok] mailbox    1 active mailbox(es) with send capability
MAILBOX_CONNECTED=true
MAILBOX_AUTH_VALID=true
SEND_PERMISSION_OK=true
```

E verifiquei a credencial de forma independente, do namespace de rede do worker:

```
SMTP AUTH  (smtp.hostinger.com:587 STARTTLS) : PASS
IMAP LOGIN (imap.hostinger.com:993 SSL)      : PASS  — 5 mailboxes, INBOX 162
```

Nada a fazer aqui.

---

## ~~Bloqueio 3~~ — RESOLVIDO: token emitido e canário executado

Você não precisava conhecer o token — emiti um, com escopo mínimo, no próprio host.
O segredo nunca passou pela conversa.

- Nome `control-center-operator`, id `59ae5d9c-8210-4891-bc26-019d2138bd03`
- `permissions = 128` — **apenas** `APIPermWriteContacts`. Sem send, sem campanha,
  sem bulk, sem leitura. Provado: write → `404` (permissão aceita, lead inexistente),
  leitura de status → `403`.
- Revogável: `UPDATE api_keys SET status='revoked', revoked_at=now() WHERE id='59ae5d9c-…';`

O canal está **ligado em produção** e o canário passou ponta a ponta, por uma sessão
Authelia real com MFA:

| Passo | Resultado |
|---|---|
| pause pelo Control Center | `200 executed` → readback Warmbly `paused=true` |
| resume sem token | `428 confirmation_required` |
| resume passo 1 | `202 challenged`, token emitido |
| resume passo 2 | `200 executed` → readback `paused=false` |
| replay do mesmo token | `428 confirmation_invalid` (single-use) |
| ledger | actor, outcome e status upstream em cada entrada |
| postura restaurada | `paused=true` |

Resistência a spoof, testada de verdade:

- `Remote-*` forjado de um hop **não** confiável → `401 missing_actor`,
  `spoofed_identity: identity headers from an untrusted hop are ignored (fail-closed)`,
  e a recusa fica registrada no ledger.
- O mesmo spoof pelo edge sem sessão → `303` para a Authelia; não chega ao canal.

---

---

## Bloqueio 4 — o ciclo de observação não fecha (interno)

Descoberto na auditoria, **não** corrigido: corrigir mudaria o que é admitido e
observado, e isso é decisão sua.

O goal define sucesso como `cohort → envio → resposta/bounce → observação →
próxima decisão`. A última etapa não se sustenta hoje:

| Evento | Registrado? | Projetado no Control Center? |
|---|---|---|
| attempted | parcial (`outreach_touchpoints.state='SENT'`) | não |
| provider accepted | não distinguível de attempted | não |
| delivered | **nada registra** | — |
| hard bounce | sim | não |
| soft bounce | **descartado antes do classificador** | — |
| reply | sim | fraco (string-match que na prática vem vazio) |
| positive reply | sim (`campaign_contact_progress.reply_class`) | não |
| routed/forwarded | nada para e-mail | — |
| unsubscribe | sim | não |
| complaint | sem FBL/webhook | — |

Três causas estruturais:

1. `wmail/bounce.go` faz `if !report.Permanent { return }` — o DSN 4.x.x é
   descartado antes de qualquer evento. A camada que conhece a classe SMTP joga
   fora, e a que decide HARD/SOFT recebe só o *subject* do DSN.
2. Todo evento de controlled-email é carimbado `Synthetic: true`, e o collector
   lê com `include_synthetic=0`.
3. O relatório que **tem** as quatro dimensões (`cohort`, `route_class`,
   `provider`, `policy_version`) é alimentado por um slice em memória e um
   arquivo `--events`. **Nenhuma query o reconstrói do Postgres.** `provider`
   nunca é gravado (sempre `UNKNOWN`); `route_class` não sobrevive na linha do
   evento, só no snapshot congelado.

Consequência prática: com o envio feito, você veria o e-mail sair e não
conseguiria medir o retorno por coorte ou por rota. Vale tratar antes de
escalar além do primeiro cohort.

---

## Correções ao enunciado do goal

- **A cohort anterior era N=50, não N=49.** Não existe artefato de N=49 em
  nenhum dos três repos. Há duas cohorts N=50 de 2026-08-22.
- **`PROBABILISTIC_OR_RISKY` já é impossível de admitir.** Não há flag:
  `build_controlled_email_cohort.py:174` recusa a classe incondicionalmente.
- **O caminho canônico não usa `export-outreach` como comando de operador.**
  Esse é o exportador do universo completo (~401.923 leads / 402 chunks). O
  produtor real é `scripts.confenge_outreach_pipeline run`, que chama
  `export_outreach()` internamente com duas opções que o CLI não expõe.
- **Orçamento de frescor: 24h** entre o `generated_at` do feed e o dispatch
  (`CONFENGE_FEED_MAX_AGE`), e o grant vive outras 24h. Foi exatamente isso que
  queimou a tentativa anterior — o TTL expirou 31,6h antes da janela seguinte
  abrir. **Não emita a autorização antes de segunda.**
- **O export nacional falhou da última vez** em `source_watermark` incompleto,
  e a cohort anterior acabou cortada do hot set de 500 contas da ativação, não
  do universo nacional. É o defeito que os PRs #454 e #462 atacam; espere
  precisar verificar isso no primeiro run.

---

## Segunda-feira, 24/08/2026 — o que sobra para você fazer

Com os três bloqueios acima resolvidos, dentro da janela (09:00–18:00 BRT):

1. Abra `https://ops.confenge.com.br`, autentique com MFA.
2. **Comercial → Coortes**. Confirme `Estado do disparo` e a janela.
3. Eu produzo/revalido o feed fresco pelo caminho canônico e importo.
4. **Revise a preview** — ela agora mostra, por destinatário amostrado: empresa,
   propósito da caixa, assunto, saudação, o fato usado *e a origem dele*, o CTA
   *e a origem dele*, por que a empresa entrou e por que aquela rota foi
   escolhida, mais o corpo completo de dois ou três. É aqui que você pega
   empresa errada, copy estranha ou personalização não merecida.
5. Emita a autorização fresca (`cohort authorize --actor <seu UUID>`), sem
   `--confirm` primeiro para ler o resumo.
6. `GO_FOR_CONTROLLED_EMAIL_PILOT` ao vivo.
7. Dispatch.

O grant é `cohort/policy bounded` — você **não** aprova 49 mensagens uma a uma.

---

## O que já está pronto e provado

- Control Center em produção com o cockpit de disparo (Governance #49, #51).
- `resume` de dois passos consertado: antes ele **nunca** completava — o token
  morria no repaint e cada clique só re-emitia um desafio.
- Estado do disparo lido tri-state: ausência é `UNKNOWN`, nunca `ATIVO`.
- Binding do cohort corrigido (warmbly #121): a busca por accounts era uma página
  de 50 sobre ~402k, e o fallback congelava `uuid.Nil`.
- Worker target-fit: claim com locks limitados ao lote (extra-cli #461).
- Semântica do produtor: campo ausente deixou de virar `false` (#454).

## Linha de base de observabilidade, antes do primeiro envio

Lido ao vivo, para que "zero" seja zero e não invenção:

```
sent_last_hour=0  queued_approved=0  active_leases=0
paused=false  in_send_window=false  cap=10  min_gap_seconds=360
window=09:00–18:00 America/Sao_Paulo  next_slot_at=2026-08-24T12:00:00Z
```
