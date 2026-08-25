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

O ensaio não pode enviar email real, emitir `GO`, retomar outbound ou executar
ação irreversível. Para cada combinação jornada/viewport, registre:

- SHA Git completo e imutável do runtime, idêntico ao SHA global da sessão;
- rotas percorridas, passos sanitizados e resultado (`PASS`, `FRICTION` ou
  `BLOCKED`);
- tempo de orientação e tempo até a primeira ação, em milissegundos;
- SHA-256 do vídeo e de ao menos uma captura de tela;
- issue e critérios de aceite de toda fricção observada.

O manifest só guarda hashes das mídias. Vídeos e capturas devem permanecer no
repositório de evidências autorizado, já sanitizados; não inclua email, nome,
telefone, payload ou segredo no JSON.

## 3. Manifest de evidência

O documento JSON tem esta forma (campos abreviados apenas nesta explicação):

```json
{
  "schemaVersion": "confenge.live-ux-audit.v1",
  "executionMode": "HUMAN_AUTHENTICATED_LIVE",
  "environment": {
    "origin": "https://ops.confenge.com.br",
    "runtimeSha": "0123456789abcdef0123456789abcdef01234567",
    "capturedAt": "2026-08-25T14:30:00-03:00"
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
`routeKeys` atribuídas pelo plano e informa `sanitizedData: true`, `steps`,
`orientationMs`, `firstActionMs`, `outcome`, `videoSha256`,
`screenshotSha256s` e `frictions`.

Uma fricção contém `severity`, `summary`, `issueUrl` numerada neste repositório e
ao menos um item em `acceptanceCriteria`. Isso vale para todas as severidades;
P0/P1 jamais podem ficar apenas em comentário, vídeo ou documento.

## 4. Validar e decidir o gate

```bash
npm run audit:ux --workspace=@confenge/control-center-web-shell -- validate evidence.json
npm run audit:ux --workspace=@confenge/control-center-web-shell -- gate evidence.json
```

`validate` retorna zero quando proveniência e completude são válidas, mesmo que
o arquivo registre uma fricção real. `gate` só retorna zero quando
`auditPassed: true`. Portanto, uma execução bloqueada pode ser preservada como
evidência honesta sem permitir o fechamento indevido da auditoria.

O resultado humano deve ser repetido após correções. A issue #111 permanece
aberta enquanto qualquer jornada estiver bloqueada, tiver fricção, exceder três
segundos de orientação ou não possuir ambas as observações.
