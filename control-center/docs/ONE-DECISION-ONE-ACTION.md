# Uma decisão humana, uma ação

Contrato de interação da issue #116. O inventário executável vive em
`apps/web-shell/src/interaction-contract.ts`; esta página explica as escolhas
operacionais sem substituir os contratos de autorização, auditoria,
idempotência ou readback do backend.

## Regra

- Conteúdo e seleção humanos permanecem entrada: nota autoral, plano, edição,
  motivo de rejeição/HOLD, seleção de versões e quantidade da cohort (1–10).
- Bookkeeping é derivado: operador autenticado, alvos já provados, data,
  versão/hash exibidos, modo de seleção, ciência implícita no CTA e motivos
  padrão.
- Uma decisão rotineira e reversível tem um botão e a consequência concreta ao
  lado. Checkbox, frase digitada e campo “motivo” sem uso operacional não são
  confirmação.
- Risco adicional mantém fricção proporcional. `resume` conserva o token em
  dois passos; `adjust` conserva edição, motivo, diff e confirmação explícita
  no botão. A versão continua sendo validada pelo backend, mas é derivada do
  card imutável em vez de copiada pelo operador.
- Reconhecimento externo, aprovação/agendamento, retomada e reconciliação não
  são tratados como reversíveis; todos mantêm confirmação de consequência ou
  dois passos.
- Todo write pinta `aria-busy` e desabilita controles antes do primeiro await,
  bloqueia duplo submit, relata executado/recusado/desconhecido e só afirma o
  efeito após readback. O orçamento para feedback local é 100 ms.
- Enter em campo textual não aciona controles marcados como arriscados; teclado
  e leitor de tela continuam acionando o botão focado normalmente.
- Texto preenchido sobrevive a recusa/erro em memória volátil. Nada é salvo em
  `localStorage` ou `sessionStorage`; sucesso confirmado ou reload o descarta.

## Inventário de mutações

| Rota | Ação | Risco | Decisão humana | Derivado / gate |
|---|---|---:|---|---|
| Hoje | Criar diretiva | baixo | título e corpo | operador, data, tipo |
| Hoje | Reconhecer alerta | baixo | um toque | alvo, operador, nota nula |
| Atividade | Atribuir triagem | baixo | um toque | alvo e operador |
| Atividade | Marcar triado | baixo | um toque | alvo, operador, nota nula |
| Exceções | Reconhecer | baixo | um toque | alvo, operador, nota nula |
| Exceções | Iniciar tratamento | baixo | plano | alvo e operador |
| Detalhe | Registrar nota | baixo | nota | alvo e operador |
| Detalhe | Marcar revisto | baixo | um toque | alvo, operador, nota nula |
| Detalhe | Revisar atividade | baixo | um toque | alvo, operador, nota nula |
| Detalhe | Confirmar próximo passo | baixo | um toque | alvo, operador, nota nula |
| Detalhe | Rejeitar próximo passo | médio | motivo | alvo e operador |
| Detalhe | Reconhecer exceção | baixo | um toque | alvo, operador, nota nula |
| Detalhe | Reabrir exceção | médio | motivo | alvo e operador |
| Detalhe | Reconhecer inbound | médio | um toque | lead provado, operador, motivo nulo |
| Rascunhos | Salvar ajuste | baixo | assunto e corpo | draft, operador, hash |
| Rascunhos | Aprovar e agendar | alto | um toque | destinatário, hash e ciência no CTA |
| Rascunhos | Rejeitar | médio | motivo | draft, operador, hash |
| Operação | Pausar outbound | médio | um toque | operador e motivo auditável padrão |
| Operação | Retomar outbound | alto | motivo + dois passos | observação e token de uso único |
| Cohorts | Criar próxima | baixo | quantidade de 1 a 10 | modo de seleção |
| Cohorts | Recuperar anteriores | médio | seleção | modo e limite de 10 |
| Revisão | Validar destinatário | baixo | um toque | versão e candidato |
| Revisão | Aprovar e enfileirar | alto | um toque | versão, candidato, destinatário e ciência |
| Revisão | HOLD/REJECT | médio | decisão e motivo | versão e candidato |
| Revisão | Ajustar | médio | conteúdo e motivo | versão, hash e diff; backend recebe confirmação |
| Revisão | Reproduzir | baixo | um toque | versão e operador |
| Revisão | Reconciliar | alto | um toque | vínculos aprovados; operação idempotente |

O reconhecimento global de inbound foi removido de Operação: digitar um ID não
prova o alvo. O operador abre a fila e reconhece no detalhe do alerta, onde o
lead foi resolvido de evidência explícita.

## Medição de passos

| Jornada crítica | Antes | Depois |
|---|---:|---:|
| Triagem diária | 3 | 1 |
| Reconhecer exceção | 3 | 1 |
| Reconhecer inbound | 4 | 1 |
| Aprovar e enfileirar | 2 | 1 |
| Ajustar versão com diff | 6 | 5 |

O probe de browser valida 390 × 844, ausência de campos redundantes nas ações
de um toque, ação não encoberta pela navegação móvel, feedback realmente
pintado dentro do orçamento e exposição do inventário compacto no runtime.
Testes de unidade impedem a reintrodução de `ciencia`, `RECONHECER`, versão
copiada e comentário de aprovação comum, além de preservar a escolha de 1 a 10
fornecedores.
