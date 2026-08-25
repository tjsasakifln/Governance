# Prova sanitizada de lotes síncronos de agentes

Este contrato permite que Governance coordene e audite os lotes da issue #129
sem virar uma base paralela de leads. Pesquisa, evidência original, CNPJ,
contatos, assunto e corpo permanecem nas autoridades privadas existentes do
extra-cli/Warmbly. O repositório público recebe somente referências opacas,
hashes, estados e contagens reconciliáveis.

O pacote não executa pesquisa, não acessa o datalake, não gera mensagem, não
importa draft e não chama provider. Ele valida uma prova produzida **depois**
que um agente conclui seu lote privado.

## Autoridades e fronteiras

- O universo e o `source_run_id` vêm do workflow canônico do extra-cli.
- A lane datalake usa `LOCAL_DATALAKE_DSN` e as consultas canônicas por CNPJ.
- A lane web é executada pelo agente, abrindo a fonte original; snippet, MX ou
  sintaxe de e-mail isolados não contam como atribuição.
- O draft é importado pelo contrato já existente e precisa ser relido como
  `NEEDS_REVIEW`.
- Governance guarda apenas
  `confenge.agent-outreach-batch-proof.v1`; nunca o feed privado.

Nenhum worker, cron, API de LLM, composer, lake, CRM ou fila é criado por este
contrato.

## Sequência obrigatória do agente

1. Reserve IDs/CNPJs disjuntos na autoridade privada e obtenha um
   `agent_batch_id`, início e expiração. Não trabalhe um membro já reservado por
   outro agente.
2. Para cada membro, execute datalake e web. Registre privadamente consultas,
   URLs originais, timestamps, contatos, conflitos e confidence.
3. Reconcilie a empresa/CNPJ. `CONFLICT`, `UNKNOWN` ou erro de qualquer lane
   bloqueia importação.
4. Quando houver e-mail atribuível, escreva o primeiro toque durante a sessão
   do agente e importe exatamente uma versão para `NEEDS_REVIEW`. Caixa
   genérica/freemail usa CTA de encaminhamento; endereço inferido é proibido.
5. Para cada membro sem draft, registre blocker e próxima ação na autoridade
   privada. Falha individual não remove o lead do denominador.
6. Releia o estado importado, calcule hashes dos bundles/recibos e exporte a
   prova sanitizada. Só então encerre a reserva.

O endereço, texto, fontes e CNPJ não são substituídos por valores fictícios no
manifesto: eles simplesmente não são exportados. `lead_ref` é uma referência
estável produzida com HMAC-SHA256 e chave privada versionada pela autoridade
operacional. Um SHA simples do CNPJ é recusado porque permitiria enumeração a
partir de listas públicas.

## Idempotência

O gate recalcula a chave pública segura sobre:

```text
source_run_id + source_run_hash + lead_ref + lead_ref_key_version + evidence_version + template_version + policy_version
```

Como `lead_ref` representa de forma estável e não enumerável o CNPJ privado,
reexecutar o mesmo tuple produz a mesma chave. Alterar source run, fato/evidência,
template ou policy produz nova versão. Ao validar mais de um manifesto, o gate
também rejeita:

- janelas de reserva sobrepostas para o mesmo `lead_ref`, inclusive entre source runs;
- dois imports `NEEDS_REVIEW` com a mesma chave idempotente;
- dois membros que reivindicam o mesmo recibo individual de importação;
- dois membros iguais dentro do mesmo lote.

## Exportação sanitizada

Parta do exemplo
`commercial/fixtures/agent-outreach-batch-proof.example.v1.json` e substitua
somente por valores sanitizados derivados do lote privado. O manifesto exige:

- denominador, processados únicos antes/depois e restante reconciliados pelo
  efeito explícito de cada membro;
- ambas as lanes por membro, mesmo quando o resultado é `NO_MATCH` ou `ERROR`;
- outcome terminal para todos os reservados;
- hashes de tentativa/evidência/conteúdo/recibo em vez dos dados;
- resumo exatamente derivado dos membros;
- zero LLM API, provider mutation, aprovação, scheduling e envio;
- `auto_send` e kill switch inalterados;
- `operational_data_included=false`.

O validador recusa campos ou valores contendo e-mail, CNPJ, URL, empresa,
contato, assunto ou corpo. Valide um lote:

```bash
python3 scripts/validate_agent_outreach_batch.py /caminho/seguro/batch-proof.json
```

Valide vários manifestos juntos para provar disjunção e idempotência:

```bash
python3 scripts/validate_agent_outreach_batch.py \
  /caminho/seguro/batch-001-proof.json \
  /caminho/seguro/batch-002-proof.json
```

Saída `ok=true` inclui o hash canônico de cada manifesto. Esse hash pode ser
referenciado na issue sem publicar o lote privado.

## O que este pacote prova — e o que não prova

Uma validação verde prova consistência estrutural, ausência de dados
operacionais no manifesto, execução declarada das duas lanes, outcome por
membro, disjunção entre os manifestos fornecidos e ausência declarada dos
efeitos proibidos. Ela não prova sozinha que o datalake, a página web ou o
recibo privado são verdadeiros; essa evidência permanece operacional e deve
ser revisável por quem possui acesso autorizado.

O fixture versionado é apenas exemplo sanitizado. Ele não declara que um lote
real, as 110 contas iniciais, as 25 `READY_TO_GENERATE`, o buffer de 500 ou o
universo de 8.245 já foram processados.
