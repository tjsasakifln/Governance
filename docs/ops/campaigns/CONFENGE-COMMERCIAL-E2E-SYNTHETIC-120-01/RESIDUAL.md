# Residual honesto por hop

`PROVEN_LIVE = 0`. `PROVEN_SANDBOX` é usado somente para QA/artefato executados pelo produtor sandbox de Governance. Os fixtures Asaas não receberam `PROVEN_SANDBOX`, pois não houve chamada ao sandbox do provider; são `PROVEN_SYNTHETIC`.

| Hop | Prova neste PR | Residual live | Owner/fato que falta |
|---|---|---|---|
| deliverable/offer | `PROVEN_SYNTHETIC` | `BLOCKED_EXTERNAL` | web-cfg #329/#343: produção/publicação e teste humano ainda não provados efetivos |
| proposal/version | `PROVEN_SYNTHETIC` | `MISSING` | Warmbly #47: fixture/produtor selecionado ainda diverge do preço autorizado de 800000 |
| acceptance vinculada | `PROVEN_SYNTHETIC` | `MISSING` | web-cfg #88: adotar proposal id/version/snapshot hash no record produtor |
| financial eligibility | `PROVEN_SYNTHETIC` | `BLOCKED_EXTERNAL` | provider real e policy runtime reconciliada não autorizados/provados |
| checkout | `PROVEN_SYNTHETIC` | `BLOCKED_EXTERNAL` | checkout de produção deliberadamente false; nenhum objeto Asaas real |
| provider event | `PROVEN_SYNTHETIC` | `BLOCKED_EXTERNAL` | nenhum evento Asaas primário; fixture STUB com `provider_object_id=null` |
| semantic reconciliation | `PROVEN_SYNTHETIC` | `MISSING` | Warmbly #47/#129: adoção runtime e evidência provider/live |
| commercial state | `PROVEN_SYNTHETIC` | `MISSING` | Warmbly #47: projeção real com o contrato/receipt novo |
| onboarding | `PROVEN_SYNTHETIC` | `BLOCKED_EXTERNAL` | gate runtime, objeto financeiro real e capacidade real não estão autorizados/provados |
| Work Order | `PROVEN_SYNTHETIC` | `BLOCKED_EXTERNAL` | upstream live e capacity staffed; contrato canônico em Governance já existe |
| QA | `PROVEN_SANDBOX` | `BLOCKED_EXTERNAL` | inputs reais autorizados, owner humano e capacidade staffed |
| delivery | `PROVEN_SANDBOX` | `BLOCKED_EXTERNAL` | entrega real foi proibida; artefato permanece sandbox e não-cliente |
| closeout | `PROVEN_SYNTHETIC` | `BLOCKED_EXTERNAL` | aceite/closeout real depende de cliente e entrega reais autorizados |
| outcome | `PROVEN_SYNTHETIC` | `MISSING` | nenhuma observação real; `UNKNOWN` foi preservado, não inferido por silêncio |

## Gaps por owner existente

- `tjsasakifln/web-cfg#88`: completar o binding acceptance → proposal/version/hash e corrigir o mapper que promove `PAYMENT_CONFIRMED` a recebido.
- `tjsasakifln/warmbly#47`: alinhar a proposta canônica a `800000`, adotar os receipts/reconciliação e decidir o gate de onboarding sem segundo ledger.
- `tjsasakifln/warmbly#129`: produzir evidência observável de provider quando houver autorização, sem tratar fixture como live.
- `tjsasakifln/web-cfg#329/#343`: provar publicação efetiva/human test da autoridade pública.
- `tjsasakifln/Governance#122/#123`: readiness dos demais itens e capacidade staffed real continuam fail-closed.

Nenhuma issue nova é necessária: cada residual externo já tem owner.
