# Auditoria da cadeia comercial → closeout #120

Data de corte: `2026-08-26`. Auditoria somente leitura dos contratos em `Governance`, `web-cfg` e `warmbly`; nenhuma chamada ao Asaas, SMTP, checkout de produção, deploy ou mutação outbound foi realizada.

## Autoridades observadas

| Autoridade | Pin observado | Uso nesta prova |
|---|---|---|
| web-cfg deliverables | main `bad3f7c71f817bbbb3605b5a7214e0fd9784111b`; blob `32576ad2e704881368699ceacdefc6c783dcfa00`; sha256 `7d9a3223069cf382f7e645cc17b0a6df859bb48196fe2541d0b882e66fc8bbe2` | ID, versão, composição, preço e escopo do único canário |
| web-cfg naming | blob `ee97d54155536378041693153d0c9316baa6596b`; sha256 `856fed4281a48c3704c204f7f2109142f992d8f0d73d6a144c6ca50d76237419` | nome público; publicação continua `PUBLISHED_UNVALIDATED` |
| Warmbly proposal v1 | main `3368e7d8f46573eef300b42ec214df8844b082d0`; `Proposal.AcceptedHash` | algoritmo de snapshot imutável reproduzido byte a byte |
| web-cfg acceptance | `scripts/offers/acceptance.cjs`, blob `afc974c4d075c72bb1ec249460f3c5c04887dc2c` | produtor atual auditado; adapter de binding é aditivo e ainda não adotado pelo owner |
| Governance delivery | implementation commit `bed2a7946d2367b445c671a819ac9d9ba6a8452b` | readiness/capacity sintéticos, Work Order canônico, QA, entrega sandbox e closeout |

O overlay v2 de Governance apontava para blobs anteriores de web-cfg. O overlay v3 corrige o pin de forma aditiva, preserva v2 como histórico e continua declarando `governance_catalog_role=NONE`.

`CFG-DIAG-EXP-v1/v1` é o único agregado operacional atravessado. Ele é o perfil de delivery já existente para o plano `/containers/0/plans/0`, composto por `CFG-D02/v1` a `CFG-D08/v1`; não é publicado como um 55º deliverable e nenhum outro item do catálogo foi promovido.

## Onde a identidade quebrava ou era duplicada

| Quebra observada antes desta prova | Natureza | Tratamento |
|---|---|---|
| A fixture aceita de Warmbly para `CFG-DIAG-EXP-v1` usa `250000`, enquanto a autoridade pinada usa `800000` centavos. | owner externo, Warmbly #47 | O canário usa uma proposta sintética nova de `800000`, validada pelo algoritmo real `AcceptedHash`; a fixture do owner não foi reescrita nem chamada de live. |
| O acceptance atual de web-cfg guarda `correlation_id`, mas não `proposal_id`, `proposal_version`, `accepted_snapshot_hash` e identidade completa do deliverable. | owner externo, web-cfg #88 | `confenge.acceptance_binding.v1` adiciona esses campos e um hash imutável para a prova; adoção no produtor permanece `MISSING`. |
| O mapper sandbox de web-cfg agrupa `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` como recebido. | owner externo, web-cfg #88 | O reducer de prova mantém os estados separados. A correção no produtor não é reivindicada por Governance. |
| `correlation_id` vinha sendo usado como identidade da cadeia, mas não havia receipt versionado demonstrando que a deduplicação ocorre por `provider_event_id`. | contrato transversal | `confenge.semantic_receipt.v1` expõe ambos e prova que são diferentes. |
| O canário de delivery começava em um handoff já marcado `SYNTHETIC_VALID`; acceptance, checkout, evento e reconciliação ficavam fora da execução. | gap de orquestração em Governance | `commercial.e2e_canary` produz o handoff somente depois dos receipts anteriores e então reutiliza o Work Order/QA/closeout existentes. |
| O estado comercial reconciliado e a decisão real de onboarding ainda não executam esta composição de contratos no runtime Warmbly. | owner externo, Warmbly #47 | O adapter puro prova a semântica, não grava ledger. Adoção real permanece `MISSING`. |
| Não existe objeto/evento Asaas real autorizado para este canário. | provider/credencial | `provider_object_id=null`; fixtures de web-cfg são rotuladas `STUB`; live permanece `BLOCKED_EXTERNAL`. |
| Readiness materializada e capacidade staffed real não existem para todo o catálogo. | Governance #122/#123 | Somente `CFG-DIAG-EXP-v1/v1` atravessa o perfil sintético; nada promove os outros 54 itens. |

## Resultado da auditoria

A prova fecha uma cadeia única com `correlation_id=corr_fixture`. A deduplicação usa `evt_sbx_payment_confirmed_001`, a Work Order é `cc:work-order:67dc4af0e65b9bbe3e0c84f75e6b25b1` e o closeout é um evento explícito. Não foi criado catálogo nem ledger. O terminal financeiro do caminho positivo é `PAYMENT_CONFIRMED`; o ramo `PAYMENT_RECEIVED` existe apenas como teste sintético e produz `0` centavos de receita recebida.

Nenhum hop é classificado `PROVEN_LIVE`. Os resíduos estão em [RESIDUAL.md](RESIDUAL.md).
