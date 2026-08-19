---
status: FOUNDER_APPROVED_LIMITED_PRODUCTION
professional_legal_review: DEFERRED_UNTIL_FIRST_REVENUE
founder_risk_acceptance: APPROVED
operational_use: LIMITED_PUBLIC_DIAGNOSIS_ONLY
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-ADVERSARIAL-REVIEW-FOUNDER-v1
package: founder-approved-v1
decision_token: FOUNDER_APPROVED_WITH_DEFERRED_COUNSEL_REVIEW_2026_08_18
---

# Revisão adversarial — founder-approved-v1

Revalidação de fontes primárias em 2026-08-18 (America/Sao_Paulo). Fontes em `SOURCE_MANIFEST.json`. Achados máquina em `ADVERSARIAL_FINDINGS.json`. P0 residual sem mitigação ou aceite nominal = 0.

Isto **não** é revisão profissional. Cada “REWRITE” abaixo é correção documental ou de fluxo. Residuais restantes são ACCEPT pelo founder.

---

## Método

Papéis sucessivos: advogado do cliente; cliente-consumidor; cliente que nega poderes; juiz; ANPD; analista de chargeback; auditor fiscal; segurança Asaas; operador de refund; atacante; concorrente; cliente que usa o relatório como texto jurídico; cliente que alega promessa de vitória.

Para cada cláusula e fluxo: ataque, hipótese, dano, probabilidade, severidade, mitigação, residual, decisão, evidência, teste.

---

## Fontes primárias usadas (não secundárias)

- CC, CDC, CPC art. 63, LGPD, MP 2.200-2/2001, Lei 14.063/2020, Lei 12.846/2013 — Planalto.
- ANPD portal e página de comunicação de incidente (URL antiga `/canais_atendimento/...` retornou 404 em 2026-08-18; a página vigente é `.../assuntos/comunicacao-de-incidentes-de-seguranca-cis`).
- STJ (portal institucional; sem cita de acórdão específico como se fosse “o STJ chancela este contrato”).
- Asaas: Checkout `billingTypes` = PIX e CREDIT_CARD; `chargeTypes` DETACHED|RECURRENT|INSTALLMENT; host produção `https://api.asaas.com/v3`; header `access_token`. BOLETO **não** documentado neste endpoint — omitido (não inventado).

---

## Decisões sobre os 10 bloqueios humanos anteriores

| id | Decisão | Resultado |
|---|---|---|
| identidade | PJ conferida em consulta pública de CNPJ | REWRITE + residual de poderes internos ACCEPT |
| foro | Comarca de Florianópolis/SC, com cogência e tutela urgente | REWRITE |
| limite | valor pago, teto nominal R$ 8.000, carve-outs, sem renúncia total | REWRITE |
| reembolso | M0–M5 + fórmula | REWRITE |
| prazo | até 15 dias úteis após quatro condições | REWRITE |
| dados | inventário por estágio + bases por finalidade | REWRITE |
| retenção | agenda explícita + rotina testável | REWRITE |
| fiscal | operador interno NOT_CLAIMED; NFS-e manual | REWRITE |
| aceite | antes do checkout; OTP/magic link; record append-only | REWRITE |
| canal | e-mail + WhatsApp; somente canal de privacidade | REWRITE |

Nenhum token de bloqueio humano permanece neste pacote.

---

## Cláusulas (síntese)

Detalhe máquina: `ADVERSARIAL_FINDINGS.json` F01–F29.

Ataques que forçaram REWRITE em relação a `diagnostico-v1.1`:

1. **Polo prestador vazio** — preenchido com razão social/CNPJ/endereço verificados; sem inventar poderes de Tiago Jun Sasaki.
2. **Foro em token** — eleito Florianópolis/SC com pertinência de sede e cumprimento administrativo; CPC 63 citado sem dizer que “obriga” a comarca.
3. **Teto sem número e sem carve-outs completos** — teto = pago ≤ 8.000; dolo, fraude, corrupção, confidencialidade intencional, LGPD consciente, PI, valores inlimitáveis, cobrança indevida e parcela não executada fora do teto; sem “renúncia a todo direito”.
4. **Prazo 10–15 sem quatro condições** — comercial 10–15; contratual até 15; relógio só após aceite + dinheiro + insumos + kickoff/dispensa.
5. **Reembolso qualitativo** — substituído por M0–M5 e `refund_due = max(0, amount_received - earned_milestones - preapproved_nonrecoverable_third_party_costs)`.
6. **LGPD com consentimento implícito e retenção aberta** — inventário, bases distintas, agenda, sem checkbox curinga, sem cargo formal inventado.
7. **Aceite “tupla comercial”** — fluxo obrigatório com OTP/magic link e recusa de checkout sem `acceptance_id`.
8. **CDC “não se destina a consumidor” lido como inaplicabilidade** — texto agora diz que CNPJ não elimina incidência e que direitos cogentes prevalecem.

Nenhum REMOVE. Nenhum HOLD de P0. SPLIT apenas conceitual (confirmação financeira ≠ receita; checkout ≠ aceite).

---

## Fluxos

| Fluxo | Ataque | Mitigação | Decisão |
|---|---|---|---|
| Elegibilidade | PF/menor/CNPJ inválido | Bloqueio + revisão manual | REWRITE |
| Aceite → checkout | Checkout sem aceite | Ordem rígida + testes | REWRITE |
| Preço | Tamper no browser | Registry 800000 | REWRITE |
| Recorrência / parcelamento | chargeTypes extras | Recusa | REWRITE |
| Boleto | Endpoint não documenta | Omitir | ACCEPT (correto) |
| Webhook | Token da API, replay, ordem invertida | Token dedicado, persist-then-2xx, idempotência | REWRITE |
| CONFIRMED vs RECEIVED | Receita antecipada | Split semântico | REWRITE |
| Refund | Mutação automática | OFF + decisão individual | REWRITE |
| Extra | Vazamento de condição privada histórica | Scan + ausência pública | REWRITE |
| Cartão | Dado completo na CONFENGE | Checkout hospedado | REWRITE |

---

## Papéis — o que cada um ainda pode fazer (residual ACCEPT)

- **Advogado do cliente:** atacar teto, foro e aceite sem ICP. Residual aceito; carve-outs e bundle de prova reduzem, não eliminam.
- **Cliente-consumidor:** pedir CDC. Residual aceito; o texto não mente que o CDC “não se aplica”.
- **Negador de poderes:** residual aceito; declaração + OTP + e-mail profissional.
- **Juiz:** pode exigir clareza — por isso o prazo contratual é um só número (15) e o reembolso é tabela.
- **ANPD:** pode questionar retenção de 10 anos e logs de IP. Residual aceito como guarda contratual/fiscal + legal hold.
- **Chargeback:** pode ganhar no cartório da bandeira mesmo com contrato. Residual operacional; exception queue.
- **Auditor fiscal:** NFS-e atrasada. Residual aceito; fila manual + NOT_CLAIMED.
- **Asaas security:** chave no lugar errado. Mitigado em código fail-closed (web-cfg).
- **Operador:** tentará “só um estorno”. Mitigado: sem auto-mutação.
- **Atacante:** preço/callback/hash. Mitigado: server-side + pin.
- **Concorrente:** publicidade. Mitigado: copy obrigatória no aviso.
- **Usuário do PDF como jurídico / promessa de vitória:** mitigado por vedação expressa; residual de uso indevido pelo cliente permanece.

---

## P0

`p0_unmitigated = 0`. Riscos altos restantes são P1 com mitigação documental e aceite executivo nominal em `FOUNDER_RISK_ACCEPTANCE.md`.
