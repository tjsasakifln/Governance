# Contrato de orientação da primeira viewport

Todas as rotas do web shell mostram o mesmo bloco cognitivo antes do conteúdo
do domínio. Em leitura corrida, ele responde:

1. **Estado atual** — se a leitura está atual, parcial, defasada, desconhecida,
   indisponível, vazia ou ainda carregando;
2. **Risco ou prioridade** — o alerta não resolvido mais severo, a primeira
   prioridade ou uma declaração explícita de que o risco não foi comprovado;
3. **Próxima ação** — uma única ação segura, uma recuperação ou a afirmação de
   que nenhuma ação é requerida agora.

O contrato é calculado em `ui/orientation.ts` a partir do mesmo `ViewState` e do
mesmo `DestinationPage` que compõem a tela. Nenhum domínio mantém uma cópia
manual do resumo.

## Regras de verdade

- `ERROR`, `UNKNOWN` e `STALE` vencem `FRESH` no resumo; falha parcial nunca
  vira panorama saudável.
- Alerta `acknowledged` continua acionável. Apenas `resolved` ou `dismissed`
  sai da fila cognitiva.
- A falta de alertas sem proveniência não vira “tudo bem”; aparece como
  atualidade e risco não comprovados.
- O horário humano usa `America/Sao_Paulo`, enquanto o instante UTC exato
  permanece no atributo `datetime`.
- Loading, vazio, erro e falta de permissão têm estado, risco e recuperação
  próprios. Uma negação de acesso nunca convida o operador a contorná-la.
- O resumo cria no máximo uma ação primária. Ela apenas leva ao conteúdo ou
  recarrega a rota; não altera autorização, não escreve e não pula confirmação.
- Uma recomendação do domínio só vira ação primária quando todas as fontes do
  recorte estão `FRESH`. Em `STALE`, `UNKNOWN` ou `ERROR`, recuperar a evidência
  sempre vence a recomendação.
- Texto de alerta, prioridade e ação é tratado como não confiável e escapado.

## Validação humana ainda necessária

Os testes automatizados impedem divergência estrutural entre rotas, verificam
os estados adversariais e fixam o alvo de toque em 44 CSS px. Isso não prova que
uma pessoa compreende a tela em três segundos.

O fechamento de Governance #106 continua exigindo exposição de exatamente três
segundos com pessoa externa à implementação, em 390×844 e nas superfícies
inventariadas pela auditoria #111. Registrar por rota:

- onde a pessoa acredita estar;
- qual risco ou prioridade identificou;
- qual próxima ação escolheria;
- acerto/erro e tempo;
- SHA do runtime e captura sanitizada.

Uma resposta errada abre ou complementa a issue específica da jornada. O
resumo comum é o contrato de produto; autoavaliação, fixture ou LLM não é prova
de compreensão humana.
