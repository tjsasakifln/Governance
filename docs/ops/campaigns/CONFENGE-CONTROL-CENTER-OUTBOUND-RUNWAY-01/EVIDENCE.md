# EVIDENCE — CONFENGE-CONTROL-CENTER-OUTBOUND-RUNWAY-01

Base: `origin/main` `cd0c5d0f7d5b5df2c8d6ccfc2bfd9ae6bb48392f` (PR #149, primeira viewport existente).

## Resultado

O bloco **Outbound Runway** estende `#/hoje`; não cria rota, CRM, ledger ou dashboard paralelo. A leitura agregada permanece sem PII e somente leitura.

As quatro respostas operacionais ficam no topo do bloco:

- transporte `GO | PAUSED | NO_GO | UNKNOWN`;
- reservoir pronto e fila `QUEUED` por readback;
- runway em dias calculado somente com slots reais;
- blocker do preenchimento/refill.

O pipeline visível conserva `TARGET_CONFIRMED → recipient attributed → eligible current → prepared → delegated approved → QUEUED → SENT`. Aprovação humana aparece separada da aprovação delegada. `SENT`, tentativa, aceite do provider e `delivered` são estágios distintos.

Cada uma das 34 métricas abre `source`, `as_of`, `freshness`, regra de interpretação e drilldown. Uma leitura `STALE`, `ERROR` ou ausente não publica contagem zero.

## Autoridade consumida

| Fato | Autoridade | Consumo no Control Center |
| --- | --- | --- |
| target, destinatário, elegibilidade, reservoir, feed/run | extra-cli | `control-center.source-observation.v1`, `source.system=extra-cli`, payload agregado do run corrente |
| prepared, delegated/human approval, HOLD, QUEUED | Warmbly | `/v1/confenge/first-touch/status` |
| lanes, feed age, refill/blocker | Warmbly | `/v1/confenge/working-overview` |
| pause/kill-adjacent e queue readback | Warmbly | `/v1/confenge/dispatch/status` |
| policy, projeção, erro de reconciliação | Governance | projeção fail-closed; não persiste fatos comerciais |

`theoretical_slots_24h`, cap e policy ceiling nunca substituem capacidade. A fórmula única é:

```text
estimated_runway_days = ready_reservoir × 7 ÷ slots_next_7d_reais
```

Se slots reais forem ausentes/zero, ou o source run divergir, o resultado é `UNKNOWN`.

## Regressões

- `recipient attributed > TARGET_CONFIRMED` invalida os números relacionados e abre divergência crítica;
- `SOURCE_RUN_MISMATCH` invalida leitura Warmbly e o cálculo de runway;
- capacidade somente teórica não produz dias de runway;
- `STALE`/`ERROR` mantém números desconhecidos, inclusive zero factual não inferido;
- reservoir `< 1000` recebe sinal explícito;
- “Revisar mensagens” conta somente `HOLD | NEEDS_REVIEW | EXCEPTION`;
- primeira viewport permite no máximo uma ação primária e não contém form/button de escrita, “aprovar tudo” ou resume de dispatch.

## Evidência sanitizada

`READBACK.sanitized.json` é uma execução sintética e autenticada do caminho de produção. Não afirma estado live, não contém recipient, mailbox, CNPJ ou outra PII e não autoriza transporte.

Screenshots:

- `screenshots/web-shell-outbound-runway-390.png` — 390×844;
- `screenshots/web-shell-outbound-runway-desktop.png` — 1280×800;
- `screenshots/web-shell.png` — contexto inicial 390×844.

## Validação local

| Gate | Resultado |
| --- | --- |
| web-shell runway unit/regression | 8 pass |
| web-shell orientation + runway | 24 pass |
| web-shell completo | 533 pass |
| Warmbly connector | 170 pass, 1 skip condicional |
| envelope convergence/schema | 4 pass |
| Context operational view/Postgres | 1 pass |
| web-shell typecheck/build | pass |
| Warmbly connector typecheck | pass |
| performance build | pass; bundle gzip 129.275 bytes; budgets móveis de LCP/INP inalterados |
| Playwright E2E 390/desktop + axe + geometry | PASS: 19 rotas, 141 checks axe, 236 checks geométricos; runway sem write controls; o journey global registra somente `START_EXCEPTION_WORK` local e allowlisted |

No laboratório móvel 390×844, a pergunta principal começou em `y=548` e o blocker em `y=690`. Em desktop 1280×800, começaram em `y=576` e `y=661`. O laboratório de performance mediu Hoje em LCP p75 `480ms`, INP p75 `32ms`, CLS p75 `0`, 14 requests p75.

## Não eventos

Nenhum e-mail real, GO, resume, kill-switch write, aprovação em massa, refresh de feed, mutação Warmbly, mutação extra-cli, provider write ou deploy de produção foi executado.
