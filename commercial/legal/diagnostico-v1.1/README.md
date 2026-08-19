---
status: FOUNDER_DECIDED_DRAFT
professional_legal_review: NOT_YET_PERFORMED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-DIAG-README-v1.1
package: diagnostico-v1.1
prior_package: provisional-v1
---

# Pacote jurídico-operacional founder-decided v1.1 — Diagnóstico B2G

Campanha: `CONFENGE-GOVERNANCE-DIAGNOSTICO-LEGAL-CLOSURE-01`
Oferta: `CFG-DIAG-EXP-v1` (R$ 8.000 / `800000` centavos / one-off)
Status de campanha: `READY_FOR_PRIVATE_NEGOTIATION`
Simultaneamente: `NOT_LEGAL_APPROVED` / `NOT_TAX_APPROVED` / `NOT_CHECKOUT_AUTHORIZED`

Sucessor do pacote imutável `commercial/legal/provisional-v1/`. O que mudou, quem decidiu, data, hash e regra de invalidação estão em `FOUNDER_DECISIONS.md` e `DECISION_CLASSIFICATION.json`.

Este diretório registra decisões empresariais do fundador para reduzir fricção de venda **sem fingir aprovação jurídica**. **Não** é revisão profissional. **Não** autoriza checkout, cobrança, publicação, NFS-e de produção ou mutação financeira. **Não** reaprova `CFG-TERMS-B2B-2026-08-17-v1`. **Não** altera o catálogo. **Não** incorpora exceção comercial privada.

`supersedable = true`: substitua após revisão profissional e após `PROFESSIONAL_GATES.md`.

---

## Artefatos

| Arquivo | Função |
|---|---|
| `FOUNDER_DECISIONS.md` | Decisões empresariais, o que mudou, quem, data, invalidação |
| `PROFESSIONAL_GATES.md` | Pendências com owner e evidência |
| `LEGAL_COUNSEL_HANDOFF.md` | Pacote curto ao advogado |
| `ACCOUNTANT_HANDOFF.md` | Pacote curto ao contador |
| `STATUS_FINAL.md` | `READY_FOR_PRIVATE_NEGOTIATION` + três `NOT_*` |
| `DECISION_CLASSIFICATION.json` | Classificação máquina das dez ids |
| `TERMOS_B2B_DIAGNOSTICO.md` | Cláusulas do one-off com founder baseline |
| `ORDEM_DE_SERVICO_DIAGNOSTICO.md` | Campos operacionais e aceite |
| `POLITICA_CANCELAMENTO_REEMBOLSO.md` | Reembolso founder-decided |
| `AVISO_LIMITACOES_TECNICAS.md` | Texto curto de preview |
| `AVISO_PRIVACIDADE_LEADS.md` | Coleta mínima de lead B2B |
| `HUMAN_DECISIONS_REQUIRED.md` | Tabela das dez ids |
| `CONSUMER_HANDOFF.md` | Instruções para web-cfg #88 e Warmbly #47 |
| `LEGAL_RISK_REGISTER.json` | Registro de riscos |
| `CLAUSE_MATRIX.json` | Matriz cláusula → risco → consumidor |
| `commercial-legal-diagnostico.schema.json` | Schema dos artefatos máquina |
| `manifest.json` | Identidade, flags fail-closed, pin do pacote anterior, hashes |
| `SHA256SUMS.txt` | Checksums SHA-256 |

---

## DPA lite — não aplicável

`DPA_LITE_B2B.md` **não existe** neste pacote. O Diagnóstico trata dados de contato B2B e insumos do cliente como controlador independente da própria prestação, não como operador sob instrução. Nenhum subprocessador é listado porque nenhum foi inventariado. Inventar DPA ou subprocessador falha o gate.

---

## Como validar

```bash
python scripts/validate_legal_provisional.py
python scripts/validate_commercial_authority.py
```

O validador imprime `AUTHORITY_HASH` do pacote anterior (congelado) e `FOUNDER_DECIDED_HASH` deste diretório. Consumidores pinam o hash novo. Dois hashes diferentes ou hash instável são defeito.

Para reescrever `SHA256SUMS.txt` e `manifest.json` **deste** pacote após editar artefatos (nunca reescreve `provisional-v1`):

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

Status proibidos: `LEGAL_APPROVED`, `PRODUCTION_AUTHORIZED`, `CHECKOUT_AUTHORIZED`.
