---
status: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
package: referral-cosell-v1
document_id: CFG-PARTNER-README-v1
canonical_issue: https://github.com/tjsasakifln/Governance/issues/7
decision_token: FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19
---

# Programa de Parceiros CONFENGE v1 — indicação e co-venda

Campanha: `CONFENGE-PARTNER-PROGRAM-GOVERNANCE-01`  
Issue canônica: [Governance #7](https://github.com/tjsasakifln/Governance/issues/7)  
Token: `FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19`

Este diretório é a autoridade **operacional e contratual** do Programa de Parceiros CONFENGE para consultorias de licitação e parceiros adjacentes. Foi produzido por revisão técnica/adversarial interna e aceito pelo founder para **negociação privada controlada**. **Não** é revisão jurídica profissional. **Não** é `LEGAL_APPROVED`. **Não** é `COUNSEL_REVIEWED`. **Não** é `LAWYER_APPROVED`. **Não** é parecer jurídico.

`supersedable = true`: substitua após revisão profissional, primeiro caso real, ou nova decisão executiva versionada.

O catálogo de ofertas, os termos de checkout, Extra e o pacote jurídico do Diagnóstico **não** são alterados por este pacote. Este diretório **não** entra em `commercial/authority/authority-manifest.v1.json`.

---

## Estado semântico

```
status                                      = FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW
professional_legal_review                   = DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance                     = APPROVED
operational_use                             = PRIVATE_NEGOTIATION_ONLY
private_negotiation_enabled                 = true
publication_enabled                         = false
real_partner_created                        = false
legal_approved                              = false
real_money_mutation_approved                = false
counsel_review_trigger                      = FIRST_PARTNER_ATTRIBUTED_REVENUE | FIRST_PAYMENT_RECEIVED
counsel_review_target_business_days         = 10
integrity_oab_conflict_auto_accept          = false
```

---

## Fluxo que este pacote autoriza a explicar

parceiro identifica demanda
→ cliente consente com apresentação
→ lead é registrado
→ CONFENGE aceita, rejeita ou pede dados em até dois dias úteis
→ CONFENGE diagnostica, propõe, contrata e entrega
→ parceiro recebe remuneração somente sobre honorários líquidos efetivamente recebidos
→ attribution e compliance permanecem auditáveis

O programa **não** é revenda irrestrita, representação perante órgãos públicos, afiliado de massa ou remuneração por vitória em licitação.

---

## Modalidades

| Código | Significado | Acordo padrão |
|---|---|---|
| `REFERRAL_QUALIFIED` | Consultoria abre a porta e contextualiza; CONFENGE assume diagnóstico, proposta, contrato e entrega | coberto |
| `COSELL_SPECIALIZED` | Escopos complementares, autoria, responsabilidades, preço e owner da conta por oportunidade | coberto somente com aditivo |
| `DISTRIBUTION_INTEGRATION` | Plataforma, rede, SaaS, associação ou operação de escala | **não** entra automaticamente; exige aditivo separado |
| `NOT_ELIGIBLE` | Concorrência direta sem fronteira, risco de integridade, operação não verificável, falta de ICP ou conflito profissional | não contrata |

---

## Números comerciais versionados

- Indicação qualificada: **10%** dos honorários líquidos efetivamente recebidos; **seis** primeiros meses; teto **total** de R$ 10.000 por cliente indicado (`cap_cents_total_per_referred_client = 1000000`; unidade TOTAL, nunca mensal). Este teto **não** é oferta pública, **não** é Extra, **não** é preço de catálogo.
- Co-venda material: **até 15%** da mesma base; **seis** primeiros meses; teto **total** de R$ 15.000 por cliente (`cap_cents_total_per_client = 1500000`); percentual exato no registro da oportunidade.
- Atribuição: consentimento para apresentação; decisão em até **dois dias úteis**; proteção de **90 dias** a partir da aceitação; não é propriedade permanente da conta.
- Comissão **nunca** usa valor de edital, obra, contrato público, economia, pleito ou vitória.

---

## Artefatos

| Arquivo | Função |
|---|---|
| `PARTNER_PROGRAM_POLICY.md` | Política do programa, fronteiras e modalidades |
| `PARTNER_AGREEMENT_B2B.md` | Instrumento B2B padrão (indicação; co-venda via aditivo) |
| `COSELLING_ADDENDUM.md` | Aditivo de co-venda material |
| `LEAD_REGISTRATION_AND_ATTRIBUTION.md` | Registro de lead, consentimento, aceitação, proteção |
| `COMMISSION_POLICY.md` | Base, evento de pagamento, estorno, documento fiscal |
| `COMMISSION_SCHEDULE.json` | Percentuais, período e tetos máquina |
| `PARTNER_DUE_DILIGENCE.md` | Checklist e estados de diligência |
| `PARTNER_CODE_OF_CONDUCT.md` | Conduta comercial e profissional |
| `PUBLIC_SECTOR_INTEGRITY.md` | Integridade e posição pública do founder |
| `CONFLICT_OF_INTEREST_POLICY.md` | Conflito real ou aparente |
| `LGPD_PARTNER_LEAD_NOTICE.md` | Fluxo de leads e minimização |
| `PROFESSIONAL_RESTRICTIONS.md` | Advocacia e profissões reguladas |
| `OAB_REVIEW_GATE.md` | Gate `PROFESSIONAL_RULE_REVIEW_REQUIRED` |
| `ANTI_CIRCUMVENTION_AND_ACCOUNT_PROTECTION.md` | Anti-circunvenção e proteção de conta |
| `TERMINATION_AND_SUSPENSION.md` | Suspensão preventiva e término |
| `PARTNER_EVENT_CONTRACT.json` | Eventos para consumidor futuro (Warmbly #47) |
| `CONSUMER_HANDOFF.md` | Pin para Warmbly #47; não é segundo ledger |
| `FOUNDER_RISK_ACCEPTANCE.md` | Aceite executivo |
| `FOUNDER_RISK_ACCEPTANCE.json` | Aceite executivo máquina |
| `COUNSEL_HANDOFF.md` | Handoff para advogado |
| `LEGAL_RISK_REGISTER.json` | Registro de riscos |
| `CLAUSE_MATRIX.json` | Cláusula → risco → consumidor |
| `partner-program.schema.json` | Schema |
| `manifest.json` | Identidade, flags, hashes |
| `SHA256SUMS.txt` | Checksums |

---

## Como validar

```bash
python scripts/validate_partner_program.py
python scripts/validate_legal_founder_approved.py
python scripts/validate_legal_provisional.py
python scripts/validate_commercial_authority.py
```

O validador deste pacote imprime `AUTHORITY_HASH sha256:<hex>`. Dois hashes diferentes ou hash instável são defeito.

Para reescrever `SHA256SUMS.txt` e `manifest.json` após editar artefatos:

```bash
python scripts/validate_partner_program.py --write-hashes
```

---

## O que isto habilita / não habilita

Habilita: negociação privada controlada do baseline de indicação e co-venda, com placeholders fail-closed de identidade do parceiro.

Não habilita: `LEGAL_APPROVED`; publicação no site; cobrança; criação de parceiro real; contato com consultorias; rascunhos no Outlook; edição de web-cfg, extra-cli, Warmbly, SmartLic ou pasta Consultoria B2G; ledger operacional; mutação automática de provider financeiro; alteração de catálogo, Extra ou Diagnóstico.
