# Runbook — primeiro cohort real de e-mail da CONFENGE

Este é o caminho operacional do experimento de no máximo **10 e-mails/dia**.
Ele não autoriza aumento de volume, auto-send ou envio em massa. O feed real
anterior tinha **N=49**; referências históricas a N=50 estão obsoletas.

Próxima janela planejada: segunda-feira, 24/08/2026, 09:00–18:00
`America/Sao_Paulo`. Releia `next_slot_at` ao vivo: o valor observado pelo
sistema prevalece sobre esta frase.

## Regras de parada

Pare sem autorizar ou enviar quando qualquer uma destas condições ocorrer:

- freshness PNCP diferente de `FRESH`, contrato ausente ou `expires_at`
  vencido;
- Control Center mostra `STALE`, `ERROR`, `UNKNOWN` crítico ou cliente sem
  identidade canônica;
- hash do feed muda entre geração, import e freeze;
- preview não reconcilia, mostra empresa/domínio errado, duplicidade,
  suppression, rota `PROBABILISTIC_OR_RISKY` ou copy não sustentada;
- mailbox, SMTP, IMAP, SPF, DKIM ou DMARC não passam no preflight;
- grant, cohort, policy ou membership divergem;
- cap não é exatamente 10, janela está fechada ou kill switch não responde;
- live GO não é `GO_FOR_CONTROLLED_EMAIL_PILOT` com todos os checks requeridos
  em PASS.

`UNKNOWN` nunca significa zero, saudável ou liberado. SMTP `250 accepted`
nunca significa delivered.

## 1. Founder: ler o estado no Control Center

1. Abra `https://ops.confenge.com.br` e autentique com MFA.
2. Vá a **Comercial → Coortes**.
3. Confirme o timestamp da última atualização, estado do disparo, cap 10,
   janela e próxima abertura.
4. Se a coorte ainda não existir, métricas devem aparecer como
   `UNKNOWN / dados ainda incompletos`, não como zeros inventados.

Não use **Retomar** nesta etapa. Deploy e rehearsal terminam pausados.

## 2. Operador: provar freshness e gerar o feed

No host `ec-prod`, em um SHA aprovado de `extra-cli/main`:

```bash
ssh ec-prod
cd /opt/extra-consultoria
git rev-parse HEAD
set -a; source /opt/extra-consultoria/.env; set +a
export PYTHONPATH=/opt/extra-consultoria

.venv/bin/python -m scripts.ops.pncp_contract_freshness \
  --live --health --json
```

Só continue com `contract_version=PNCP_CONTRACT_FRESHNESS/1.0`, `status=FRESH`,
janela fechada e `expires_at` útil para terminar prepare/freeze/authorize/send.
O produtor repete esse gate e falha fechado:

```bash
RUN_ROOT=/var/lib/extra-consultoria/private/outreach/runs/first-real-$(date -u +%Y%m%dT%H%M%SZ)

.venv/bin/python -m scripts.confenge_outreach_pipeline run \
  --out "$RUN_ROOT" \
  --use-activation-planner \
  --activation-capacity 500 \
  --allow-network \
  --enable-web-search \
  --max-workers 4 \
  --no-resume

.venv/bin/python -m scripts.ops.build_controlled_email_cohort \
  --feed-dir "$RUN_ROOT/06_warmbly_feed" \
  --private-root /var/lib/extra-consultoria/private/outreach/cohorts \
  --limit 10
```

Registre o SHA-256 gerado e a distribuição por rota. Não copie endereços,
nomes ou o feed para Git ou para o artefato sanitizado.

## 3. Operador: importar e congelar exatamente os mesmos bytes

Publique os bytes privados pelo transporte HTTPS allowlisted do plano CONFENGE.
No host Warmbly:

```bash
cd /opt/warmbly-confenge
BE=warmbly-confenge-backend-1
ORG=$(docker exec "$BE" printenv CONFENGE_OPERATOR_ORG_ID)
NAME=controlled-email-cohort-fresh

cat .deployed_sha
docker exec "$BE" env | grep '^CONFENGE_REPOSITORY_SHA='

docker exec "$BE" /app/confenge import \
  --feed "https://confenge-feed:8443/$NAME.json" \
  --org-id "$ORG" --dry-run

docker exec "$BE" /app/confenge import \
  --feed "https://confenge-feed:8443/$NAME.json" \
  --org-id "$ORG"

docker exec "$BE" wget -q -O "/data/confenge-ops/$NAME.json" \
  "https://confenge-feed:8443/$NAME.json"

docker exec "$BE" /app/confenge cohort prepare \
  --feed "/data/confenge-ops/$NAME.json" \
  --org-id "$ORG" \
  --out "/data/confenge-ops/$NAME-frozen.json" \
  --limit 10 --max-daily 10 --ttl 24h

docker exec "$BE" /app/confenge cohort preview \
  --manifest "/data/confenge-ops/$NAME-frozen.json"
```

O preview precisa declarar `reconciled=true`. O hash do feed, `cohort_hash`,
`recipient_set_hash`, policy e membership são derivados pelo código; nunca os
transcreva manualmente.

## 4. Founder: revisar a preview

Revise a coorte versionada, não dezenas de aprovações individuais. Para a
amostra e as mensagens completas confirme:

- empresa, domínio e rota pertencem à mesma entidade;
- não há identidade, nome ou cargo inventado;
- assunto, corpo, fato/proveniência, CTA e rationales são defensáveis;
- há uma rota inicial por account;
- somente `DIRECT_PERSON`, `ROLE_OR_DEPARTMENT`, `GENERIC_COMPANY` e
  `PUBLIC_COMPANY_FREEMAIL` aparecem;
- duplicidade cross-account, suppression, hard bounce prévio e opt-out estão
  ausentes.

Se reprovar uma rota, descarte a coorte e gere/freeze outra. Não edite o feed
congelado.

## 5. Dentro da janela: autorização limitada e live GO

Não emita grant antecipadamente. Já dentro da janela, faça primeiro a
simulação sem `--confirm`, depois persista a autorização exata:

```bash
docker exec "$BE" /app/confenge cohort authorize \
  --manifest "/data/confenge-ops/$NAME-frozen.json" \
  --actor <FOUNDER_UUID> --org-id "$ORG"

docker exec "$BE" /app/confenge cohort authorize \
  --manifest "/data/confenge-ops/$NAME-frozen.json" \
  --actor <FOUNDER_UUID> --org-id "$ORG" --confirm
```

Confirme `authorized_touchpoints=selected_accounts`, falhas zero, cap 10 e TTL
útil. Então use **Retomar** no Control Center: desafio em dois passos, confirmação
single-use e readback `paused=false`.

```bash
docker exec "$BE" /app/confenge cohort review \
  --id <AUTHORIZATION_ID> --actor <FOUNDER_UUID>
```

Só com live GO completo, persista a decisão humana:

```bash
docker exec "$BE" /app/confenge cohort review \
  --id <AUTHORIZATION_ID> --actor <FOUNDER_UUID> \
  --verdict READY_FOR_CONTROLLED_EMAIL_GO_REVIEW \
  --reason "founder reviewed frozen first-real-10 cohort" --confirm
```

## 6. Founder: preview final e dispatch

```bash
docker exec "$BE" /app/confenge cohort dispatch \
  --id <AUTHORIZATION_ID> --actor <FOUNDER_UUID> --limit 10

docker exec "$BE" /app/confenge cohort dispatch \
  --id <AUTHORIZATION_ID> --actor <FOUNDER_UUID> --limit 10 --confirm
```

O primeiro comando não envia. O segundo só enfileira membros admitidos se
cohort, policy, grant, cap, janela, suppression e kill switch ainda forem
válidos. `auto_send=false` permanece.

## 7. Observar e decidir o próximo lote

Em **Comercial → Coortes**, espere a reconciliação e leia por coorte/rota:
autorizados, enviados, SMTP accepted, hard/soft bounce, replies, positive
replies e opt-outs. Delivery e complaint permanecem UNKNOWN sem evidência do
provider.

Antes de qualquer próximo lote:

1. pause novamente pelo Control Center e confirme o readback;
2. reconcilie eventos pendentes/duplicados;
3. trate hard bounce e opt-out como suppression obrigatória;
4. registre o que foi observado e o que continua UNKNOWN;
5. decida manter, corrigir ou encerrar — não aumente o cap neste goal.

Comando de emergência equivalente no host:

```bash
docker exec "$BE" /app/confenge stop-sending
```

## Rehearsal seguro

Para ensaio, execute as seções 1–4 e o primeiro comando de `authorize`, sem
`--confirm`. Rode `cohort review` apenas sobre um grant de ensaio inexistente ou
expirado e prove NO_GO/fora da janela. Não execute `resume-sending` nem dispatch
com `--confirm`. A evidência deve terminar com `REAL_EMAIL_SENT=false` e sem
grant prematuramente válido.
