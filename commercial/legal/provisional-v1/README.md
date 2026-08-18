---
status: PROVISIONAL_AI_DRAFT
professional_legal_review: NOT_YET_PERFORMED
operational_use: HUMAN_DECISION_REQUIRED
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-PROVISIONAL-README-v1
package: provisional-v1
---

# Pacote jurídico-operacional provisório v1 — Diagnóstico B2G

Campanha: `CONFENGE-LEGAL-BOOTSTRAP-V1-01`  
Oferta: `CFG-DIAG-EXP-v1` (R$ 8.000 / `800000` centavos / one-off)  
Status de campanha: `PROVISIONAL_PACKAGE_READY_FOR_FOUNDER_DECISIONS`

Este diretório é um rascunho operacional versionado para o fundador negociar o primeiro Diagnóstico B2G com risco visível. **Não** é revisão jurídica profissional. **Não** autoriza checkout, cobrança, publicação, NFS-e de produção ou mutação financeira. **Não** reaprova `CFG-TERMS-B2B-2026-08-17-v1`. **Não** altera o catálogo. **Não** incorpora exceção comercial privada.

`supersedable = true`: substitua após revisão profissional e após `HUMAN_DECISIONS_REQUIRED.md`.

---

## Artefatos

| Arquivo | Função |
|---|---|
| `TERMOS_B2B_DIAGNOSTICO.md` | Cláusulas mínimas do one-off |
| `ORDEM_DE_SERVICO_DIAGNOSTICO.md` | Campos operacionais e aceite |
| `POLITICA_CANCELAMENTO_REEMBOLSO.md` | Cancelamento one-off conservador |
| `AVISO_LIMITACOES_TECNICAS.md` | Texto curto de preview |
| `AVISO_PRIVACIDADE_LEADS.md` | Coleta mínima de lead B2B |
| `HUMAN_DECISIONS_REQUIRED.md` | Decisões que não podem ser presumidas |
| `FISCAL_HANDOFF_TO_ACCOUNTANT.md` | Perguntas ao contador |
| `CONSUMER_HANDOFF.md` | Instruções para web-cfg #88 e Warmbly #47 |
| `LEGAL_RISK_REGISTER.json` | Registro de riscos |
| `CLAUSE_MATRIX.json` | Matriz cláusula → risco → consumidor |
| `commercial-legal-provisional.schema.json` | Schema dos artefatos máquina |
| `manifest.json` | Identidade, flags fail-closed, hashes |
| `SHA256SUMS.txt` | Checksums SHA-256 |

---

## DPA lite — não aplicável

`DPA_LITE_B2B.md` **não existe** neste pacote. O Diagnóstico trata dados de contato B2B e insumos do cliente como controlador independente da própria prestação, não como operador sob instrução. Nenhum subprocessador é listado porque nenhum foi contratado neste instrumento. Inventar DPA ou subprocessador falha o gate.

Se uma contratação futura exigir operação de base do cliente, abra versão nova com revisão profissional.

---

## Como validar

```bash
python scripts/validate_legal_provisional.py
python scripts/validate_commercial_authority.py
```

O validador legal imprime `AUTHORITY_HASH sha256:<hex>` do manifesto canônico deste pacote. Consumidores pinam esse hash. Dois hashes diferentes ou hash instável são defeito.

Para reescrever `SHA256SUMS.txt` e `manifest.json` após editar artefatos:

```bash
python scripts/validate_legal_provisional.py --write-hashes
```

---

## Flags fail-closed

```
production_checkout_enabled    = false
public_activation_approved     = false
real_money_mutation_approved   = false
legal_terms_forum              = UNKNOWN
dpa_lite_applicable            = false
checkout_authorized            = false
publication_authorized         = false
cobranca_authorized            = false
```

Status proibidos neste pacote: `LEGAL_APPROVED`, `PRODUCTION_AUTHORIZED`, `CHECKOUT_AUTHORIZED`.

---

## O que isto habilita / não habilita

Habilita: o fundador negociar o primeiro one-off com texto conservador, escopo alinhado ao catálogo e limitações explícitas.

Não habilita: checkout, cobrança, publicação pública, NFS-e de produção, ativação recorrente, aprovação do gate `legal_terms_forum`, nem uso do relatório como revisão jurídica profissional.
