# Auditoria humana das jornadas autenticadas

Este contrato operacional cobre a auditoria viva de UX de Governance #111. Ele
mantém duas conclusões separadas:

1. **evidência válida**: a execução humana é identificável, completa, sanitizada
   e cobre todas as rotas e jornadas exigidas;
2. **auditoria aprovada**: além de válida, toda observação terminou em `PASS` e a
   orientação inicial ocorreu em até 3.000 ms.

Gerar uma matriz, executar testes automatizados ou validar um JSON não substitui
o operador humano externo no ambiente autenticado. O plano gerado sempre usa
`status: NOT_EXECUTED` e nunca é aceito como evidência.

## 1. Gerar a matriz atual

Na raiz de `control-center`:

```bash
npm run --silent audit:ux --workspace=@confenge/control-center-web-shell -- plan > /tmp/live-ux-plan.json
```

As rotas vêm diretamente de `DESTINATIONS`, `COMMERCIAL_SURFACES` e
`WARMBLY_SURFACES`. O teste de consistência falha quando uma rota registrada não
é atribuída a uma jornada. O plano contém as dez jornadas mínimas, os dois
viewports e as issues transversais relacionadas.

## 2. Executar sem efeitos reais

Use `https://ops.confenge.com.br`, dados sanitizados e um operador humano externo
sem memória da arquitetura. Repita cada jornada:

- no viewport principal exato de 390×844, simulando uso com uma mão;
- em um desktop complementar de pelo menos 1280×720.

O manifesto registra `inputMode: ONE_HANDED_TOUCH` no mobile e
`inputMode: DESKTOP_POINTER_KEYBOARD` no desktop; apenas redimensionar uma
janela de automação não satisfaz essa atestação.

O ensaio não pode enviar email real, emitir `GO`, retomar outbound ou executar
ação irreversível. Para cada combinação jornada/viewport, registre:

- SHA Git completo e imutável do runtime, idêntico ao SHA global da sessão;
- respostas completas e `PINNED` de `/runtime-identity` (web) e
  `/v1/runtime-identity` (context), ambas em produção, no mesmo SHA e baseline;
- rotas percorridas, passos sanitizados e resultado (`PASS`, `FRICTION` ou
  `BLOCKED`);
- resultado individual de cada `requiredCheck` da jornada; stale, erro,
  permissão negada e desfecho desconhecido são quatro verificações distintas;
- tempo de orientação e tempo até a primeira ação, em milissegundos;
- SHA-256 de um vídeo e de ao menos uma captura de tela exclusivos daquela
  observação;
- issue e critérios de aceite de toda fricção observada.

O manifest só guarda hashes das mídias. Vídeos e capturas devem permanecer no
repositório de evidências autorizado, já sanitizados; não inclua email, nome,
telefone, payload ou segredo no JSON.

O validador rejeita propriedades fora do contrato e literais óbvios de email,
CPF/CNPJ e telefone. Isso reduz vazamento acidental, mas não substitui a revisão
humana da sanitização das mídias.

## 3. Manifest de evidência

O documento JSON tem esta forma (campos abreviados apenas nesta explicação):

```json
{
  "schemaVersion": "confenge.live-ux-audit.v1",
  "executionMode": "HUMAN_AUTHENTICATED_LIVE",
  "environment": {
    "origin": "https://ops.confenge.com.br",
    "runtimeSha": "0123456789abcdef0123456789abcdef01234567",
    "capturedAt": "2026-08-25T14:30:00-03:00",
    "webRuntimeIdentity": {
      "schema_version": "control-center.runtime-identity.v1",
      "service": "control-center-web",
      "release_sha": "0123456789abcdef0123456789abcdef01234567",
      "required_baseline_sha": "64ece7d38abacd3adeaa02735b4f22af66caab0f",
      "release_status": "PINNED",
      "production_required": true
    },
    "contextRuntimeIdentity": {
      "schema_version": "control-center.runtime-identity.v1",
      "service": "control-center-context",
      "release_sha": "0123456789abcdef0123456789abcdef01234567",
      "required_baseline_sha": "64ece7d38abacd3adeaa02735b4f22af66caab0f",
      "release_status": "PINNED",
      "production_required": true
    }
  },
  "operator": {
    "pseudonym": "external-operator-01",
    "role": "skeptical operations reviewer",
    "human": true,
    "independent": true
  },
  "safety": {
    "syntheticDataOnly": true,
    "realEmailSent": false,
    "goIssued": false,
    "outboundResumed": false,
    "irreversibleAction": false
  },
  "observations": []
}
```

Use o plano gerado para preencher as 20 observações obrigatórias: dez jornadas
vezes dois viewports. Cada observação repete o `runtimeSha`, lista exatamente as
`routeKeys` atribuídas pelo plano, registra cada `requiredCheck` uma vez em
`checks` e informa `sanitizedData: true`, `steps`,
`orientationMs`, `firstActionMs`, `outcome`, `videoSha256`,
`screenshotSha256s` e `frictions`.

Uma fricção contém `severity`, `summary`, `issueUrl` numerada neste repositório e
ao menos um item em `acceptanceCriteria`. Isso vale para todas as severidades;
P0/P1 jamais podem ficar apenas em comentário, vídeo ou documento. A validação
consulta o GitHub e falha se a URL não resolver para uma issue real (um PR com o
mesmo número não conta).

## 4. Validar e decidir o gate

```bash
npm run audit:ux --workspace=@confenge/control-center-web-shell -- validate evidence.json
npm run audit:ux --workspace=@confenge/control-center-web-shell -- gate evidence.json /caminho/para/midias-sanitizadas
```

`validate` retorna zero quando proveniência, completude e referências de issues
são válidas, mesmo que o arquivo registre uma fricção real. `gate` recalcula o
SHA-256 dos arquivos sob o diretório autorizado e só retorna zero quando todos
os hashes existem e `auditPassed: true`. Portanto, uma execução bloqueada pode
ser preservada como evidência honesta sem permitir o fechamento indevido da
auditoria. Um JSON com hashes inventados nunca deixa o gate verde.

O resultado humano deve ser repetido após correções. A issue #111 permanece
aberta enquanto qualquer jornada estiver bloqueada, tiver fricção, exceder três
segundos de orientação ou não possuir ambas as observações.
