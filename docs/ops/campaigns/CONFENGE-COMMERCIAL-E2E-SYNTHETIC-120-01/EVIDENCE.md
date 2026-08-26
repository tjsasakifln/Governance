# Evidence pack sanitizado

Artefato canônico: [EVIDENCE.json](EVIDENCE.json)

- schema: `confenge.commercial_e2e_evidence.v1`
- pack: `CFG-COMMERCIAL-E2E-SYNTHETIC-120-v1`
- sha256 do arquivo: `963c7e51c7355f1a7222efd4dfecd663789c1611b63112002848670d9f03d131`
- implementation SHA: `bed2a7946d2367b445c671a819ac9d9ba6a8452b`
- correlation identity: `corr_fixture`
- proposta: `320f817a-5b2b-5799-b403-2ce8c731e120` / version `1`
- accepted snapshot: `sha256:69254bd6ca91b91ddb1c4bc25afdbc3f5b4b7e2bff120864ef32cf7e9929d257`
- acceptance: `acc_synthetic_governance_120`
- receipt financeiro aplicado: `receipt_49812e913bca64ecc947367834c20121`
- Work Order: `cc:work-order:67dc4af0e65b9bbe3e0c84f75e6b25b1`
- closeout event: `cc:work-order-event:0549c2e995b85cd6dd1da8ead42d548c`
- caminho financeiro positivo: `PAYMENT_CONFIRMED`
- received revenue: `0` centavos
- outcome: `UNKNOWN`

O JSON contém os 14 hops com ID, versão, hash, estado, receipt, classe da prova e residual live. Também contém os receipts de duplicate, out-of-order, retry/replay, evento desconhecido, os gates negativos de onboarding/readiness e o manifest do ciclo Work Order/QA/delivery/closeout.

## Sanitização e limites

Não há CNPJ, email, token, URL secreta, provider object real ou dado de cliente. IDs `evt_sbx_*` e referências `sandbox/fixtures` são fontes versionadas de teste de web-cfg. `provider_object_id` permanece `null`; `production_checkout_enabled`, `real_money_mutation_approved`, `real_money`, `real_customer` e `received_revenue` permanecem `false`.

Este pack prova compatibilidade e execução sintética/sandbox. Ele não prova receita, cliente, cobrança, checkout Asaas, envio, entrega real nem runtime live.
