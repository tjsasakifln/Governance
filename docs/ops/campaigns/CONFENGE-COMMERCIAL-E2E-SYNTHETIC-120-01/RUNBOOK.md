# Runbook reproduzível

## Pré-condições

- checkout em produção e dinheiro real continuam desabilitados;
- nenhuma credencial Asaas, Warmbly, SMTP ou cliente é necessária;
- Node/TypeScript do `control-center` deve estar instalado com o mecanismo normal do workspace;
- para reprodução byte a byte do evidence pack checked-in, use o implementation commit `bed2a7946d2367b445c671a819ac9d9ba6a8452b`.

## Executar

```bash
npm --prefix control-center run install
PYTHONPATH=. python3 -m commercial.e2e_canary \
  --state-dir /tmp/confenge-commercial-e2e-120 \
  --output /tmp/confenge-commercial-e2e-120/EVIDENCE.json
```

Saída terminal esperada:

```text
correlation_id=corr_fixture
work_order_id=cc:work-order:67dc4af0e65b9bbe3e0c84f75e6b25b1
financial_state=PAYMENT_CONFIRMED
received_revenue_cents=0
```

Validar contratos e testes:

```bash
python3 scripts/validate_commercial_authority.py
python3 -m pytest -q
npm --prefix control-center run typecheck
npm --prefix control-center test
```

## O que a execução deve demonstrar

1. alteração de um byte material da proposta aceita é rejeitada pelo snapshot hash;
2. acceptance divergir de proposal/version/hash é rejeitado;
3. onboarding antes do receipt financeiro ou sem capacity retorna `BLOCKED`;
4. `PAYMENT_CONFIRMED` antes de `PAYMENT_CREATED` fica `HELD` e aplica somente em replay explícito;
5. repetição do mesmo `provider_event_id` retorna `DUPLICATE`;
6. retry atrasado de created retorna `RETAINED`, sem regressão;
7. evento desconhecido permanece `UNKNOWN`/`HELD`;
8. rebuild pelos eventos aplicados converge em `PAYMENT_CONFIRMED` e receita zero;
9. a Work Order nasce uma vez, QA negativo falha, QA positivo passa, delivery é `SANDBOX`, closeout é explícito e outcome permanece `UNKNOWN`;
10. a projeção do Control Center tem zero mutações e somente `source/freshness/state/receipt/exception` em cada hop.

## Replay e rollback

Reexecutar com o mesmo `--state-dir` deve preservar o mesmo `work_order_id`, `work_order_count=1`, `duplicate_business_mutations=0` e `replay_converged=true`. A projeção intermediária de capacity pode já aparecer `RELEASED`, pois o primeiro run fechou a Work Order; isso é passagem temporal explícita, não duplicação.

Rollback desta prova é descartar apenas o diretório temporário informado em `--state-dir`. Nenhum estado externo foi gravado. Não execute a prova apontando para stores, URLs ou credenciais reais.

## Stop conditions

Pare e mantenha `BLOCKED_EXTERNAL` se qualquer execução pedir credencial, objeto/provider real, checkout de produção, `real_money_mutation_approved=true`, SMTP, dados reais de cliente ou mutação outbound. Um JSON local nunca pode substituir evidência Asaas live.
