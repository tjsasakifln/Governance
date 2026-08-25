# Continuidade global de tarefa

O contrato `control-center.task-continuity.v1` governa mensagens, inbound, exceções, leads, clientes e atividades. A URL é a fonte de verdade para busca, filtros, ordenação, página e seleção; o DOM e closures de um repaint não são armazenamento.

## Navegação e ação

- detalhe → voltar recompõe a URL da fila e usa um marcador de foco de uso único;
- uma ação com receipt definitivo leva ao próximo item acionável, à primeira linha da próxima página ou ao resumo de fim da fila;
- resultado `unknown` não avança nem remove o alvo: o operador permanece onde pode fazer readback;
- filtros alterados preservam foco/caret, e paints assíncronos obsoletos não substituem o paint da navegação mais recente;
- subrotas irmãs preservam busca, filtros compatíveis, ordenação, tamanho da página e `resource`, mas não carregam número/posição de uma página que pertence a outra fila;
- back/forward e deep links reproduzem o estado funcional porque não dependem de memória volátil.

O foco programático só é movido depois de um paint pronto: para a linha exata, primeira linha da nova página ou contagem da fila. O alvo recebe `preventScroll` seguido de centralização deliberada, evitando salto para o topo e fornecendo contexto ao leitor de tela.

## Reload, reautenticação e privacidade

`sessionStorage` guarda por até 12 horas apenas uma projeção validada da rota, vinculada à identidade de ator que o servidor injeta no documento. Podem persistir: busca, facetas, ordenação, página, tamanho da página, offset, `resource`, posição de retorno, freshness e preferência de expansão. Reautenticar como outro ator na mesma aba descarta o recorte anterior; metadado de identidade ausente ou inválido desabilita a persistência.

Nunca persistem em storage: texto de notas, motivo, assunto, corpo, confirmação, decisão não submetida, modo de edição, estado sintético de vista ou marcador de foco. Uma nota de ação sem resultado definitivo permanece somente em memória volátil para sobreviver ao repaint e permitir readback/repetição consciente; sucesso a apaga e reload/reauth também. O servidor continua sendo a autoridade para qualquer efeito. Storage ausente/corrompido/expirado é descartado; rota inválida recupera `Hoje` com aviso, em vez de renderizar vazio.

O armazenamento é de sessão, não compartilhado entre abas e não promovido para `localStorage`. Uma nova autenticação do mesmo ator na mesma aba pode recuperar o recorte; fechar a sessão do navegador encerra essa continuidade local.

O custo de entrega permanece dentro do teto agregado de 120.000 bytes gzip. O subteto de JavaScript é 113.000 bytes para comportar o contrato após deduplicação e manter margem de compressor; CSS gzip e o limite agregado não foram ampliados.

## Matriz automatizada

Os testes exercitam ação → próxima, detalhe/seleção → fila, reload, expiração de sessão, rota inválida, transição de subrota e foco em próxima página/fim da fila. O navegador consome a lista executável `CONTINUITY_SURFACE_CONTRACTS` e exige o alvo renderizado de cada uma das seis famílias em 390 px e 1280 px; uma fila não pode sair silenciosamente do contrato.
