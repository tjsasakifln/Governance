# Gate visual, acessível e comparável

O E2E produtivo isolado gera uma matriz visual a partir dos mesmos registries
que montam a navegação. `DESTINATIONS`, `COMMERCIAL_SURFACES` e
`WARMBLY_SURFACES` são a fonte: uma rota nova entra no gate automaticamente.

## Evidência bloqueante

Para cada rota registrada, o gate executa a superfície pronta em:

- 390×844;
- 768×1024;
- 1440×1000.

No viewport primário, loading, vazio, stale e erro também são exercitados em
todas as rotas. Nos dois viewports complementares, esses estados são repetidos
em Hoje. Screenshots full-page usam nomes estáveis por viewport, rota e estado.

Cada observação bloqueia quando encontra:

- violação axe `serious` ou `critical` sob WCAG A/AA;
- overflow horizontal do documento;
- conteúdo preso em mais de um scroll vertical concorrente;
- runtime SHA ausente ou divergente entre meta, UI e endpoint;
- erro de página ou crash.

O resultado `visual-gate-manifest.json` registra SHA, rotas, viewports, estado,
violações concretas, geometria e a declaração de segurança. O redutor E2E relê
o manifest e exige exatamente uma observação axe e geométrica para cada célula
obrigatória; cobertura parcial, duplicada ou um contador que contradiga as
violações é falha. O workflow
publica o JSON e as capturas mesmo quando o gate falha, para permitir revisão
humana do diff sem atualizar baseline às cegas.

## Limites honestos

O ambiente é a pilha autenticada isolada com fixtures sanitizadas e identidade
imutável; o manifest declara `live_production_claimed: false`. A sonda registra
método, caminho e tipo de ação de todo request de escrita. Somente a ação local
`START_EXCEPTION_WORK` da fixture é permitida; qualquer outra escrita falha o
gate. Assim ela não envia email real, não emite GO, não retoma outbound e não
executa ação irreversível por simples autodeclaração.

Este gate ainda não é a auditoria humana de #111 e não mede compreensão. O
smoke autenticado no ambiente canônico e a revisão humana das diferenças
significativas continuam obrigatórios para fechar #110. Lighthouse mobile
também permanece um diagnóstico complementar a integrar: seu score nunca pode
substituir as falhas concretas de axe e geometria já bloqueadas aqui.
