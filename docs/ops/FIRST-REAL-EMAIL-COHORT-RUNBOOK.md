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

## Bloqueio 2 — credenciais SMTP/IMAP vazias em produção

O caminho de rede está **ok**: de dentro do namespace do worker,
`smtp.hostinger.com:587` e `imap.hostinger.com:993` respondem. O que falta é
exclusivamente credencial.

Verificado nos três contêineres (`backend`, `worker`, `consumer`):

```
SMTP_USERNAME=            # vazio
SMTP_PASSWORD=            # vazio
CONFENGE_MAILBOX_EMAIL=tiago.sasaki@confenge.com.br
# CONFENGE_SMTP_PASSWORD / CONFENGE_IMAP_PASSWORD: não definidas
```

O código lê, em ordem (`internal/app/confenge/release_live.go:183-184`):
`CONFENGE_IMAP_USER` → `IMAP_USER` → `CONFENGE_MAILBOX_EMAIL`, e
`CONFENGE_IMAP_PASSWORD` → `IMAP_PASSWORD` → `CONFENGE_MAILBOX_PASSWORD`.

**O que preciso de você:** a senha da caixa `tiago.sasaki@confenge.com.br`
(ou uma senha de aplicativo criada no hPanel). Me passe e eu escrevo em
`/opt/warmbly-confenge/.env.confenge` com permissão `600`, reinicio os serviços
e provo SMTP AUTH + IMAP LOGIN reais.

`MAIL_TRANSPORT=log` **não** é problema: o envio do cohort usa
`CONFENGE_SMTP_HOST` (Hostinger), separado do transporte de notificação
(`release_live.go:112`).

---

## Bloqueio 3 — token Warmbly com escrita para o Control Center

O canal de operador está **montado e desligado por padrão** (fail-closed: toda
rota devolve `404 operator_channel_not_configured`). Para ligar falta um token.

O token do collector é **read-only** — provei com um POST inócuo:

```
POST /v1/confenge/inbound/00000000-.../acknowledge  →  403
```

**O que preciso:** um token Warmbly com `PermManageContacts` /
`APIPermWriteContacts`. Com ele eu:

1. gravo em `/etc/confenge/control-center/secrets/.env`:
   `CC_WARMBLY_BASE_URL=http://warmbly-confenge-backend-1:8080`
   `CC_WARMBLY_OPERATOR_TOKEN=<token>`
2. incluo o overlay já preparado
   `/etc/confenge/control-center/docker-compose.warmbly-operator.yml`
3. subo o `context` e rodo o canário completo: pause → readback → resume_confirm
   → resume → readback → ledger.

O canal continua limitado a exatamente três ações. **Não existe SEND_EMAIL nele
e não deve passar a existir.**

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
