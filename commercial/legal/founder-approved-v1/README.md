---
status: FOUNDER_APPROVED_LIMITED_PRODUCTION
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: LIMITED_PUBLIC_DIAGNOSIS_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-FOUNDER-APPROVED-README-v1
package: founder-approved-v1
offer_code: CFG-DIAG-EXP-v1
decision_token: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW_2026_08_18
---

# Pacote jurídico founder-approved v1 — Diagnóstico B2G

Campanha: `CONFENGE-LEGAL-RISK-ACCEPTANCE-ASAAS-PRODUCTION-01`  
Oferta aprovada: `CFG-DIAG-EXP-v1` (R$ 8.000 / `800000` centavos / one-off)  
Token: `FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW_2026_08_18`

Este diretório é a autoridade jurídica **operacional e limitada** do Diagnóstico B2G one-off. Foi aprovada pelo founder sob aceitação consciente de risco residual, depois de revisão adversarial e mitigação documental. **Não** é revisão jurídica profissional. **Não** é `LEGAL_APPROVED`. **Não** é `COUNSEL_REVIEWED`. **Não** é `LAWYER_APPROVED`.

`provisional-v1` e `diagnostico-v1.1` permanecem imutáveis. Contratos já aceitos naqueles hashes não são reescritos.

`supersedable = true`: substitua após a revisão profissional disparada pela primeira `PAYMENT_RECEIVED` real, ou por nova decisão executiva versionada.

---

## Estado semântico

```
professional_legal_review              = DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance                = APPROVED
commercial_terms_status                = FOUNDER_APPROVED_LIMITED_PRODUCTION
public_activation_approved             = true
production_checkout_approved           = true
approved_offer_scope                   = ["CFG-DIAG-EXP-v1"]
approved_amount_cents                  = 800000
approved_billing_mode                  = ONE_TIME
recurring_offers_production_checkout_approved = false
automated_refund_or_cancellation_approved     = false
automated_nfse_approved                = false
counsel_review_trigger                 = FIRST_PAYMENT_RECEIVED
counsel_review_target_business_days    = 10
```

O catálogo global (`production-gates.v1.json`) permanece fail-closed para recorrência e para mutação financeira automática. Esta pasta autoriza **somente** a jornada pública + checkout hospedado do Diagnóstico.

---

## Artefatos

| Arquivo | Função |
|---|---|
| `TERMOS_B2B_DIAGNOSTICO.md` | Instrumento B2B do one-off |
| `ORDEM_DE_SERVICO_DIAGNOSTICO.md` | Campos operacionais e aceite |
| `POLITICA_CANCELAMENTO_REEMBOLSO.md` | Marcos M0–M5 e fórmula |
| `AVISO_LIMITACOES_TECNICAS.md` | Texto público curto |
| `AVISO_PRIVACIDADE_LEADS.md` | Inventário, bases e canal de privacidade |
| `RETENTION_SCHEDULE.json` | Agenda de retenção e descarte |
| `ELECTRONIC_ACCEPTANCE_SPEC.json` | Aceite anterior ao checkout |
| `INCIDENT_RESPONSE_MINIMUM.md` | Resposta mínima a incidente |
| `ADVERSARIAL_REVIEW.md` | Revisão cláusula a cláusula |
| `ADVERSARIAL_FINDINGS.json` | Achados máquina |
| `LEGAL_RISK_REGISTER.json` | Registro de riscos (P0 = 0) |
| `CLAUSE_MATRIX.json` | Cláusula → risco → consumidor |
| `FOUNDER_RISK_ACCEPTANCE.md` | Aceite executivo em linguagem direta |
| `FOUNDER_RISK_ACCEPTANCE.json` | Aceite executivo máquina |
| `CONSUMER_HANDOFF.md` | Pin para web-cfg #88 e Warmbly #47 |
| `PUBLICATION_SUMMARY.md` | O que pode ir à superfície pública |
| `SOURCE_MANIFEST.json` | Fontes primárias revalidadas |
| `commercial-legal-founder-approved.schema.json` | Schema |
| `manifest.json` | Identidade, flags, hashes |
| `SHA256SUMS.txt` | Checksums |

---

## Como validar

```bash
python scripts/validate_legal_founder_approved.py
python scripts/validate_legal_provisional.py
python scripts/validate_commercial_authority.py
```

O validador deste pacote imprime `AUTHORITY_HASH sha256:<hex>`. Consumidores pinam esse hash em `CONFENGE_LEGAL_AUTHORITY_HASH`. Dois hashes diferentes ou hash instável são defeito.

Para reescrever `SHA256SUMS.txt` e `manifest.json` após editar artefatos:

```bash
python scripts/validate_legal_founder_approved.py --write-hashes
```

---

## O que isto habilita / não habilita

Habilita: publicação da oferta `CFG-DIAG-EXP-v1`, aceite eletrônico versionado, checkout Asaas hospedado individual (Pix e cartão, cobrança única), Webhook de produção com flags fail-closed, conciliação e fila manual de NFS-e.

Não habilita: planos recorrentes, parcelamento, boleto no Checkout hospedado (o endpoint oficial de Checkout não lista `BOLETO`), estorno automático, NFS-e automática, nem qualquer afirmação de que a revisão profissional já ocorreu.
