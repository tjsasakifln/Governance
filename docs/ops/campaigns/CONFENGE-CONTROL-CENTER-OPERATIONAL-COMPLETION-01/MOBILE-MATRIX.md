# Mobile matrix

EXECUTED_CODE_SHA: `80e75e6faa0d37a4c6632d72552ddbd574ede455`

CI Playwright on that SHA (workflow `control-center` e2e job) installed Chromium + libnspr4, exercised 360/390/430/desktop, overflow=0, uploaded artifact `control-center-e2e-screenshots` (id `9465703704`).

Local Chromium still lacks libnspr4. CI is the blessed execution evidence.

Adversarial screenshot review of artifact 9465703704:

| Page | 360 | 390 | 430 | desktop |
| --- | --- | --- | --- | --- |
| Hoje | overflow=0, filled | overflow=0 | overflow=0 | overflow=0 |
| Comercial visão | subnav first; distinct from cohorts | overflow=0 | overflow=0 | overflow=0 |
| Coortes | distinct; Coortes heading + inbound-truth card | overflow=0 | overflow=0 | overflow=0 |
| Atividade | distinct | overflow=0 | overflow=0 | overflow=0 |
| Pipeline | distinct | overflow=0 | overflow=0 | overflow=0 |
| Exceções | distinct; Control Center-only disclaimer | overflow=0 | overflow=0 | overflow=0 |
| Clientes | overflow=0 | overflow=0 | overflow=0 | overflow=0 |
| Client detail | overflow=0 | overflow=0 | overflow=0 | overflow=0 |
| Financeiro | overflow=0 | overflow=0 | overflow=0 | overflow=0 |
| Engenharia | overflow=0 | overflow=0 | overflow=0 | overflow=0 |
| Infra | overflow=0 | overflow=0 | overflow=0 | overflow=0 |
| Crescimento | organic absence honest; hops visible | overflow=0 | overflow=0 | overflow=0 |
| Memória | overflow=0 | overflow=0 | overflow=0 | overflow=0 |
| Agentes | overflow=0 | overflow=0 | overflow=0 | overflow=0 |

Usability notes:

- Bottom nav and commercial subnav are 44px min-height. Subnav is sticky at the top of main; extra pills (Exceções) scroll horizontally inside `.subnav` (allowed).
- Earlier CI artifact on `7f30b8c` had identical 360/390 commercial surface PNGs because the recorte filled the viewport. Fixed in `013c631` by putting subnav first and skipping recorte on non-visão surfaces. Confirmed distinct hashes on `80e75e6`.
- Operator exception copy is visible on Exceções at 360: "Reconhecer no Control Center é um registro de auditoria local. Isto não resolve a exceção no Warmbly."

`MOBILE_FIRST_PROVEN_360_390_430=true`
