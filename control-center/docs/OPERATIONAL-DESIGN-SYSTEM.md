# Sistema visual operacional do Control Center

Este contrato governa padrões já usados pelas telas reais. Ele não cria uma biblioteca paralela nem transforma tudo em card: cada componente tem uma função na hierarquia operacional e um seletor verificável no produto.

## Tokens semânticos

Os tokens vivem em `apps/web-shell/src/styles.css`. Tokens antigos (`--bg`, `--crit` etc.) permanecem como base durante a migração progressiva; componentes novos consomem os papéis semânticos.

| Dimensão | Contrato | Uso |
|---|---|---|
| superfícies | `--surface-page`, `--surface-raised`, `--surface-card` | página, painel e agrupamento de dados |
| texto | `--text-primary`, `--text-secondary`, `--measure-reading` | decisão, contexto e largura de leitura |
| estados | `--state-critical`, `--state-alert`, `--state-success`, `--state-unknown` | estado operacional; sempre junto de símbolo e rótulo |
| ação/foco | `--action-primary`, `--focus`, `--focus-width`, `--control-min-size` | uma ação primária, foco visível e alvo de 44 px |
| espaço/densidade | `--space-1/2/3/4/6`, `--density-control-block` | ritmo repetível sem comprimir desktop no mobile |
| forma/elevação | `--radius-control`, `--radius-panel`, `--elevation-overlay` | controle, painel e overlay, sem bordas ornamentais |
| tipografia | `--type-page`, `--type-section`, `--type-body`, `--font`, `--mono` | página, seção, corpo e evidência técnica |
| motion | `--motion-fast` | transição curta; vira `0ms` com reduced motion |

Em 390 px, ações e navegação são tarefas explícitas, os fatos empilham e os controles mantêm 44 px. Em desktop, a coluna chega a `--content-max` e usa grade somente quando a comparação ganha clareza. Mobile não é uma grade desktop espremida.

## Componentes e hierarquia

`OPERATIONAL_COMPONENT_CONTRACT` é a lista executável de dez componentes. Seus seletores apontam para implementações reais:

1. cabeçalho de página — nome e resumo do recorte;
2. resumo de estado — estado, risco e próxima ação antes dos dados;
3. prioridade — o trabalho ordenado que exige atenção;
4. barra de ação — no máximo uma ação primária, seguida de alternativas secundárias;
5. item de fila — escolha compacta; o editor permanece único no inspector;
6. formulário — coleta intenção e mostra espera, sem duplicar submissão;
7. feedback — crítico, atenção, confirmado, unknown, stale, bloqueado, loading e empty;
8. estado de vista — feedback aplicado a loading/empty/stale/error de todas as rotas;
9. detalhe técnico — evidência recolhida, não concorrente com a decisão;
10. confirmação — diz o que ainda não ocorreu e o que o próximo envio fará.

O helper de feedback sempre combina símbolo, rótulo textual, título e `role`; cor nunca é o único sinal. Dado, diagnóstico e evidência usam fatos/detalhe. Ação fica na barra de ação. Uma borda separa estrutura; não substitui hierarquia.

Ações destrutivas ou de alto risco não herdam aparência de sucesso. Unknown e bloqueado nunca recebem verde. Uma barra com mais de uma ação primária viola o contrato `data-primary-actions` e deve falhar em teste.

## Catálogo e gate

O catálogo é exportado pelo mesmo global do shell e renderizado pelos mesmos helpers adotados em todas as rotas. Ele cobre os oito estados, texto longo, dado ausente, prioridade, fila, formulário, confirmação e detalhe técnico.

O E2E injeta o catálogo dentro do shell real em `390 × 844` e `1440 × 1000`, executa axe WCAG 2.2 AA, overflow e contexto de scroll, e salva screenshots no artefato visual. O CI exige `component_catalog=PASS components=10 viewports=2 axe_checks=2`.

A integração com o gate de performance reutiliza as classes existentes de card, fila e orientação. O custo deliberado dos tokens e estados semânticos eleva o teto de CSS cru de 24.000 para 26.000 bytes; os tetos comprimidos permanecem 7.000 bytes para CSS e 120.000 bytes para o bundle total. Assim, o contrato novo cabe no orçamento publicado sem esconder o custo de fonte nem afrouxar a entrega efetiva pela rede.

## Migração e exceções

A adoção é progressiva: este primeiro recorte consolida cabeçalho, orientação, ação e feedback globais. Formulários, fila, detalhe e confirmação já têm seletores reais documentados; superfícies de domínio migram para os helpers quando forem alteradas, sem refatoração big bang.

Uma exceção precisa explicar por que a informação ou ação não cabe em nenhum componente, qual risco a diferença resolve e quando será reavaliada. Preferência visual do implementador não é justificativa.
