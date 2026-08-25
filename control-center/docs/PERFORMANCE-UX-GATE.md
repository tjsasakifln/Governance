# Gate de desempenho percebido do web-shell

Este gate transforma a parte reproduzível da #112 em orçamento bloqueante. Ele não usa um score agregado: publica medidas por rota, amostras e p75 em JSON.

## O que bloqueia o CI

`apps/web-shell/performance-budgets.json` é a fonte versionada dos limites. O build falha quando JavaScript ou CSS cru/gzip ultrapassa o orçamento. O laboratório abre `Hoje`, `Comercial > Rascunhos` e `Warmbly > Coortes` quatro vezes cada em `390 × 844`, com 120 ms de latência, 1,6 Mbps de download, 750 kbps de upload e CPU 4× mais lenta.

O contrato global de continuidade acrescenta restauração validada, isolamento por ator, retomada de foco, deep link de cliente e proteção do rascunho volátil. Depois de deduplicar os atributos de fila, o artefato integrado mede 111.999 bytes de JavaScript gzip; por isso o subteto explícito passou de 110.000 para 113.000 bytes, com margem para variação do compressor. O teto de entrega agregado permanece 120.000 bytes gzip, sem aumento, e continua sendo a barreira contra transferir custo entre JavaScript e CSS.

Por rota, o p75 precisa respeitar:

- INP de laboratório ≤ 200 ms;
- LCP ≤ 2,5 s;
- CLS ≤ 0,1;
- feedback pintado após pointer/teclado ≤ 100 ms;
- estrutura útil após uma navegação interna ≤ 200 ms;
- maior tarefa longa ≤ 350 ms sob CPU 4× (equivalente a aproximadamente 87,5 ms de CPU sem throttling);
- no máximo 16 requests no cold load autenticado.

O HTML já contém um status útil, com topbar, hierarquia e explicação, antes da execução do bundle. O tempo dessa estrutura inicial após o primeiro byte continua no relatório como diagnóstico; a navegação interna é a medida bloqueante de 200 ms, enquanto o cold load é governado por LCP.

O runtime comprime HTML, JavaScript, CSS e respostas JSON substanciais quando o cliente aceita gzip. O catálogo de fixtures fica em chunk sob demanda e nunca integra o caminho inicial de produção. Conteúdo fora da dobra permanece com geometria completa: o orçamento não autoriza otimizações que prejudiquem axe, foco ou alvos táteis.

## Evidência e comparação

O job `e2e` publica o artefato `control-center-performance` mesmo quando falha:

- `build.json`: assets, bytes crus/gzip, limites e violações;
- `mobile-lab.json`: todas as 12 amostras, p75 por rota, checks, simulação, SHA e resultado.

Os dois schemas e a mesma matriz versionada permitem comparar o artefato entre SHAs e investigar a rota responsável, em vez de esconder o gargalo em uma média geral.

Cada amostra registra `inp_source`. A fonte preferida é `performance_event_timing`; se o Chromium omitir a entrada de um clique real, o gate usa `interaction_to_structure_proxy`, o tempo conservador entre o evento e a nova estrutura útil. A origem fica explícita para que o proxy nunca seja apresentado como medição canônica de campo.

## Limites honestos e segurança

`ISOLATED_AUTHENTICATED_MOBILE_LAB` usa o web-shell de produção contra o Context Service isolado. A rota de rascunhos recebe uma fixture somente leitura; nenhum endpoint de escrita é interceptado ou acionado. O manifesto fixa em `false` e-mail real, GO, retomada de outbound e ação irreversível.

O relatório declara `canonical_environment_sampled: false`. Portanto, este gate não fecha sozinho a #112: a amostra de cold load, navegação e ação autenticada no ambiente canônico, além da tendência histórica dos artefatos, ainda precisa ser operacionalizada. Lighthouse pode complementar o diagnóstico, mas não substitui as métricas e gargalos por rota.
