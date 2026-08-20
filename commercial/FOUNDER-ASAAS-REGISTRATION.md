# Founder Asaas registration handoff

Open Asaas. Type the fields below. Do not interpret architecture.
Do not create a customer, cobrança, checkout or webhook from this document.
Do not paste API keys or checkout URLs back into git.
Do not call the Asaas API from this repository.

Policy de `externalReference`: `cfg:{offer_id}:{correlation_id}`

After cadastro, copy IDs into a `mapping-copyback.v1` payload and run:
`python scripts/validate_commercial_authority.py --check-mapping <payload.json>`
Then, only if that check passes, paste IDs into `commercial/providers/asaas-mapping.v1.json`.
Set mapping `status` to `MAPPED`. `verified_at` stays null until a separate human check.
Mapping does not enable checkout and does not approve real_money.

## A. você pode cadastrar agora

As quatro ofertas v1 abaixo têm nome, valor, billing e escopo. Cadastre no Asaas (manual).
Depois copie os IDs de volta. Não publique, não ative checkout, não cobre.

### CFG-DIAG-EXP-v1

- nome exato: `CONFENGE - Diagnóstico B2G de Expansão`
- descrição: `CONFENGE - Diagnóstico B2G de Expansão. Pagamento único. Entrega em 10 a 15 dias úteis após alinhamento e dados.`
- valor: `R$ 8.000,00` (`800000` centavos)
- billing mode: `ONE_TIME` (cobrança única)
- cycle: `n/a (não preencher ciclo)`
- maxPayments: `sem máximo — não preencher maxPayments nem endDate`
- total: `800000 (R$ 8.000,00) pagamento único`
- o que cadastrar: produto avulso (pagamento único) e checkout/link; não criar assinatura
- qual ID copiar de volta: `asaas_product_id` e `checkout_id` (`subscription_mapping` permanece null)
- qual campo do mapping preencher: `commercial/providers/asaas-mapping.v1.json` mappings[CFG-DIAG-EXP-v1]: asaas_product_id, checkout_id, environment, created_at; `copied_at` no payload de copy-back
- qual validator rodar: `python scripts/validate_commercial_authority.py --check-mapping <payload.json>`
- o que continua OFF: `production_checkout_enabled`, `real_money_mutation_approved`, publicação pública, Extra, SmartLic, checkout recorrente, NFS-e automática, refund automático
- `externalReference` policy: `cfg:CFG-DIAG-EXP-v1:{correlation_id}`
- Mapping atual: asaas_product_id=`null`, checkout_id=`null`, subscription_mapping=`null`, status=`PENDING_MANUAL_CADASTRO`

### CFG-DIRB2G-FLEX-v1

- nome exato: `CONFENGE - Diretoria B2G Fracionada - Flex`
- descrição: `CONFENGE - Diretoria B2G Fracionada - Flex. Assinatura mensal. Sem prazo mínimo. Aviso prévio de 30 dias.`
- valor: `R$ 20.000,00` (`2000000` centavos)
- billing mode: `RECURRING` (recorrente)
- cycle: `MONTHLY`
- maxPayments: `sem máximo — não preencher maxPayments nem endDate`
- total: `n/a — sem compromisso mínimo; não preencher total`
- o que cadastrar: produto e assinatura MONTHLY; não preencher maxPayments nem endDate
- qual ID copiar de volta: `asaas_product_id` e `subscription_mapping` (`checkout_id` permanece null)
- qual campo do mapping preencher: `commercial/providers/asaas-mapping.v1.json` mappings[CFG-DIRB2G-FLEX-v1]: asaas_product_id, subscription_mapping, environment, created_at; `copied_at` no payload de copy-back
- qual validator rodar: `python scripts/validate_commercial_authority.py --check-mapping <payload.json>`
- o que continua OFF: `production_checkout_enabled`, `real_money_mutation_approved`, publicação pública, Extra, SmartLic, checkout recorrente, NFS-e automática, refund automático
- `externalReference` policy: `cfg:CFG-DIRB2G-FLEX-v1:{correlation_id}`
- Mapping atual: asaas_product_id=`null`, checkout_id=`null`, subscription_mapping=`null`, status=`PENDING_MANUAL_CADASTRO`

### CFG-DIRB2G-180-v1

- nome exato: `CONFENGE - Diretoria B2G Fracionada - 180`
- descrição: `CONFENGE - Diretoria B2G Fracionada - 180. Assinatura mensal. Máximo de 6 cobranças. Sem renovação automática.`
- valor: `R$ 15.000,00` (`1500000` centavos)
- billing mode: `RECURRING` (recorrente)
- cycle: `MONTHLY`
- maxPayments: `6`
- total: `9000000 (R$ 90.000,00) = 6 × 1500000`
- o que cadastrar: produto e assinatura MONTHLY com maxPayments=6; sem renovação silenciosa
- qual ID copiar de volta: `asaas_product_id` e `subscription_mapping` (`checkout_id` permanece null)
- qual campo do mapping preencher: `commercial/providers/asaas-mapping.v1.json` mappings[CFG-DIRB2G-180-v1]: asaas_product_id, subscription_mapping, environment, created_at; `copied_at` no payload de copy-back
- qual validator rodar: `python scripts/validate_commercial_authority.py --check-mapping <payload.json>`
- o que continua OFF: `production_checkout_enabled`, `real_money_mutation_approved`, publicação pública, Extra, SmartLic, checkout recorrente, NFS-e automática, refund automático
- `externalReference` policy: `cfg:CFG-DIRB2G-180-v1:{correlation_id}`
- Mapping atual: asaas_product_id=`null`, checkout_id=`null`, subscription_mapping=`null`, status=`PENDING_MANUAL_CADASTRO`

### CFG-DIRB2G-365-v1

- nome exato: `CONFENGE - Diretoria B2G Fracionada - 365`
- descrição: `CONFENGE - Diretoria B2G Fracionada - 365. Assinatura mensal. Máximo de 12 cobranças. Sem renovação automática.`
- valor: `R$ 12.500,00` (`1250000` centavos)
- billing mode: `RECURRING` (recorrente)
- cycle: `MONTHLY`
- maxPayments: `12`
- total: `15000000 (R$ 150.000,00) = 12 × 1250000`
- o que cadastrar: produto e assinatura MONTHLY com maxPayments=12; sem renovação silenciosa
- qual ID copiar de volta: `asaas_product_id` e `subscription_mapping` (`checkout_id` permanece null)
- qual campo do mapping preencher: `commercial/providers/asaas-mapping.v1.json` mappings[CFG-DIRB2G-365-v1]: asaas_product_id, subscription_mapping, environment, created_at; `copied_at` no payload de copy-back
- qual validator rodar: `python scripts/validate_commercial_authority.py --check-mapping <payload.json>`
- o que continua OFF: `production_checkout_enabled`, `real_money_mutation_approved`, publicação pública, Extra, SmartLic, checkout recorrente, NFS-e automática, refund automático
- `externalReference` policy: `cfg:CFG-DIRB2G-365-v1:{correlation_id}`
- Mapping atual: asaas_product_id=`null`, checkout_id=`null`, subscription_mapping=`null`, status=`PENDING_MANUAL_CADASTRO`

## B. não ativar/publicar ainda

Do NOT activate yet (every offer):

- recurring production checkout
- `production_checkout_enabled` permanece false
- `real_money_mutation_approved` permanece false
- `public_activation_approved` permanece false
- automated refund or cancellation
- automated NFS-e
- Extra historical R$ 10.000/mês
- SmartLic billing
- silent renewal
- live charge before IDs are copied back and verified
- mapping copy-back does not publish the public catalog
- mapping copy-back does not approve LEGAL_APPROVED

## C. aguarda campo/decisão

- `LOW_FRICTION_ENTRY_OFFER` permanece `PENDING_FOUNDER_INPUT` (não inventar preço, nome, billing ou escopo)
- IDs Asaas permanecem `PENDING_MANUAL_CADASTRO` até copy-back manual validado
- `LEGAL_APPROVED` não marcar
- capacity inventory staffed numbers beyond the 50-slot policy
- accountant NFS-e classification
- counsel review after first `PAYMENT_RECEIVED`
