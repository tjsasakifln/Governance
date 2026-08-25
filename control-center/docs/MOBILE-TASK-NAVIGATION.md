# Navegação móvel orientada às tarefas

No mobile, o Control Center não apresenta as dez áreas como um trilho horizontal.
Quatro tarefas ficam sempre visíveis:

- entender a atenção de **Hoje**;
- **Revisar** mensagens;
- tratar **Exceções**;
- inspecionar **Clientes**.

`Mais tarefas` é um painel nativo `details/summary`, identificado por texto e
operável sem JavaScript. Ele torna diretamente alcançáveis tratar inbound,
pausar outbound e checar incidente de infraestrutura, além das demais áreas do
produto. Não é um menu hambúrguer indiferenciado: cada entrada usa verbo,
objeto e contexto operacional.

O desktop continua mostrando o registro completo de áreas. Ambos os modos usam
links hash reais, portanto preservam deep links, histórico, back/forward,
teclado e semântica de `aria-current`.

## Regras de interação

- Existem exatamente quatro destinos primários móveis e uma entrada explícita
  para as demais tarefas.
- A rota atual corresponde a uma única tarefa global. Quando ela está no painel
  secundário, o painel inicia aberto e a entrada atual fica visível.
- Toda área em `DESTINATIONS` possui ao menos uma entrada móvel; nenhuma depende
  de swipe, hover ou memória.
- Alvos de toque têm no mínimo 44 CSS px e a barra respeita
  `safe-area-inset-bottom`.
- Textos longos quebram linha. O painel secundário rola verticalmente dentro de
  um limite, nunca lateralmente.
- Subnavegações contextuais usam grid no mobile e `flex-wrap` no desktop. Um
  segundo trilho horizontal não é permitido.
- O painel apenas navega. Não envia email, não emite GO, não retoma outbound e
  não executa mutação.

## Validação pendente

Os testes automatizados verificam cobertura do registro, links profundos,
estado atual único, semântica nativa, ausência de overflow horizontal, zoom
estrutural e alvos de toque. O fechamento de Governance #107 ainda exige uma
pessoa externa à implementação nos viewports 360×800, 390×844, 430×932 e
desktop, incluindo textos longos e zoom de 200%.

Registrar se, em três segundos, a pessoa identifica a área atual e inicia sem
instrução prévia cada uma destas tarefas: revisão, inbound, exceção, pausa de
outbound, cliente e incidente de infraestrutura. Fixture, autoavaliação ou LLM
não substitui essa evidência humana.
