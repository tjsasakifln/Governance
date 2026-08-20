# Founder Asaas registration handoff

Open Asaas. Type the fields below. Do not interpret architecture.
Do not create a customer, cobrança, checkout or webhook from this document.
Do not paste API keys or checkout URLs back into git.

Policy de `externalReference`: `cfg:{offer_id}:{correlation_id}`

After cadastro, copy back into `commercial/providers/asaas-mapping.v1.json`:
`asaas_product_id`, `checkout_id`, `subscription_mapping` (if any), `environment`, `created_at`.
Then set `status` to `MAPPED` only after a human verifies the IDs. `verified_at` stays null until that check.

## Do NOT activate yet (every offer)

- recurring production checkout
- automated refund or cancellation
- automated NFS-e
- Extra historical R$ 10.000/mês
- SmartLic billing
- silent renewal
- live charge before IDs are copied back and verified

## CFG-DIAG-EXP-v1

- Nome exato: `CONFENGE - Diagnóstico B2G de Expansão`
- Descrição para Asaas: `CONFENGE - Diagnóstico B2G de Expansão. Pagamento único. Entrega em 10 a 15 dias úteis após alinhamento e dados.`
- Valor: `R$ 8.000,00` (`800000` centavos)
- Cobrança: `cobrança única` (`ONE_TIME`)
- Ciclo: `n/a (não preencher ciclo)`
- Número máximo de cobranças: `sem máximo — não preencher maxPayments nem endDate`
- `externalReference` policy: `cfg:CFG-DIAG-EXP-v1:{correlation_id}`
- Mapping atual: asaas_product_id=`null`, checkout_id=`null`, subscription_mapping=`null`, status=`PENDING_MANUAL_CADASTRO`
- Copiar de volta após cadastrar: asaas_product_id, checkout_id, subscription_mapping, environment, created_at
- NÃO ativar ainda: checkout recorrente, refund automático, NFS-e automática, Extra, SmartLic, cobrança ao vivo

## CFG-DIRB2G-FLEX-v1

- Nome exato: `CONFENGE - Diretoria B2G Fracionada - Flex`
- Descrição para Asaas: `CONFENGE - Diretoria B2G Fracionada - Flex. Assinatura mensal. Sem prazo mínimo. Aviso prévio de 30 dias.`
- Valor: `R$ 20.000,00` (`2000000` centavos)
- Cobrança: `recorrente` (`RECURRING`)
- Ciclo: `MONTHLY`
- Número máximo de cobranças: `sem máximo — não preencher maxPayments nem endDate`
- `externalReference` policy: `cfg:CFG-DIRB2G-FLEX-v1:{correlation_id}`
- Mapping atual: asaas_product_id=`null`, checkout_id=`null`, subscription_mapping=`null`, status=`PENDING_MANUAL_CADASTRO`
- Copiar de volta após cadastrar: asaas_product_id, checkout_id, subscription_mapping, environment, created_at
- NÃO ativar ainda: checkout recorrente, refund automático, NFS-e automática, Extra, SmartLic, cobrança ao vivo

## CFG-DIRB2G-180-v1

- Nome exato: `CONFENGE - Diretoria B2G Fracionada - 180`
- Descrição para Asaas: `CONFENGE - Diretoria B2G Fracionada - 180. Assinatura mensal. Máximo de 6 cobranças. Sem renovação automática.`
- Valor: `R$ 15.000,00` (`1500000` centavos)
- Cobrança: `recorrente` (`RECURRING`)
- Ciclo: `MONTHLY`
- Número máximo de cobranças: `6`
- `externalReference` policy: `cfg:CFG-DIRB2G-180-v1:{correlation_id}`
- Mapping atual: asaas_product_id=`null`, checkout_id=`null`, subscription_mapping=`null`, status=`PENDING_MANUAL_CADASTRO`
- Copiar de volta após cadastrar: asaas_product_id, checkout_id, subscription_mapping, environment, created_at
- NÃO ativar ainda: checkout recorrente, refund automático, NFS-e automática, Extra, SmartLic, cobrança ao vivo

## CFG-DIRB2G-365-v1

- Nome exato: `CONFENGE - Diretoria B2G Fracionada - 365`
- Descrição para Asaas: `CONFENGE - Diretoria B2G Fracionada - 365. Assinatura mensal. Máximo de 12 cobranças. Sem renovação automática.`
- Valor: `R$ 12.500,00` (`1250000` centavos)
- Cobrança: `recorrente` (`RECURRING`)
- Ciclo: `MONTHLY`
- Número máximo de cobranças: `12`
- `externalReference` policy: `cfg:CFG-DIRB2G-365-v1:{correlation_id}`
- Mapping atual: asaas_product_id=`null`, checkout_id=`null`, subscription_mapping=`null`, status=`PENDING_MANUAL_CADASTRO`
- Copiar de volta após cadastrar: asaas_product_id, checkout_id, subscription_mapping, environment, created_at
- NÃO ativar ainda: checkout recorrente, refund automático, NFS-e automática, Extra, SmartLic, cobrança ao vivo
