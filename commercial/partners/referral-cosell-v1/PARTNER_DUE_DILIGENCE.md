---
status: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: PRIVATE_NEGOTIATION_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
package: referral-cosell-v1
document_id: CFG-PARTNER-DUE-DILIGENCE-v1
canonical_issue: https://github.com/tjsasakifln/Governance/issues/7
decision_token: FOUNDER_APPROVED_PARTNER_PROGRAM_DEFERRED_COUNSEL_2026_08_19
---

# Diligência do parceiro

**clause_id:** `sancoes_due_diligence`

Checklist e estados versionados. Sem score reputacional opaco. Sem coleta invasiva. **Não** é `LEGAL_APPROVED`. Identidade real de parceiro **não** é inventada neste pacote.

Estados:

| Estado | Significado |
|---|---|
| `APPROVED` | Diligência suficiente para negociação privada da modalidade indicada, com identidade completa e gates claros |
| `APPROVED_WITH_LIMITATIONS` | Aprovado com restrições escritas (ex.: só `REFERRAL_QUALIFIED`, sem marca, volume baixo) |
| `NEEDS_INFO` | Faltam evidências; placeholders críticos presentes |
| `LEGAL_REVIEW_REQUIRED` | OAB, profissão regulada, sanção, PEP/conexão pública material, ou cláusula atípica |
| `REJECTED` | `NOT_ELIGIBLE`, integridade, identidade inverificável, ou recusa founder |
| `SUSPENDED` | Suspensão preventiva após aprovação anterior |

`APPROVED` e `APPROVED_WITH_LIMITATIONS` **são proibidos** quando:

- `[[FAIL_CLOSED:PARTNER_LEGAL_NAME]]`, `[[FAIL_CLOSED:PARTNER_CNPJ]]`, foro de parceiro ou `[[FAIL_CLOSED:PARTNER_PROFESSIONAL_REGISTRY]]` permanecem vazios/placeholder;
- `modality = NOT_ELIGIBLE`;
- `professional_flag = PROFESSIONAL_RULE_REVIEW_REQUIRED` sem revisão específica posterior (neste caso o estado máximo automático é `LEGAL_REVIEW_REQUIRED`);
- conflito de integridade `REAL`, `APPARENT` ou `UNRESOLVED`;
- o pacote tenta marcar `real_partner_created = true`.

---

## Campos e evidências (quando legalmente pertinentes e públicos/fornecidos)

- identidade empresarial (razão social, nome fantasia);
- CNPJ e status cadastral público;
- sócios/beneficiário final **somente quando necessário** ao risco (não como coleta padrão);
- domínio e canais oficiais;
- serviço real prestado (site, contrato-tipo, descrição);
- reputação **material** e verificável (fato, não score opaco);
- sanções/listas aplicáveis quando o risco exigir;
- PEP/conexões públicas quando o risco exigir;
- vínculo com advocacia ou profissão regulada;
- conflitos declarados;
- política de integridade própria, se houver;
- capacidade de obter consentimento e registrar leads;
- tratamento de dados (minimização, canal de oposição);
- responsável nomeado;
- data e freshness da diligência;
- reason codes da decisão.

Não coletar dado sensível, dado de menor, dado de saúde, dado biométrico, nem documento de cliente de licitação sem autorização.

---

## Reason codes (não exaustivo)

`IDENTITY_PLACEHOLDER`, `CNPJ_INVALID_OR_MISSING`, `PROFESSIONAL_RULE_REVIEW_REQUIRED`, `INTEGRITY_CONFLICT`, `NOT_ELIGIBLE_COMPETITOR`, `NO_ICP_ACCESS`, `UNVERIFIABLE_OPERATION`, `SANCTIONS_HIT`, `LGPD_CAPABILITY_MISSING`, `NEEDS_INFO`, `FOUNDER_REJECTED`.

---

## Freshness

Diligência `APPROVED` com mais de 12 meses sem revalidação cai para `NEEDS_INFO` antes de novo acordo ou de primeiro pagamento de comissão. Evento: `partner_due_diligence_decided`.
