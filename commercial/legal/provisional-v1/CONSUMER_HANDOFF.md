---
status: PROVISIONAL_AI_DRAFT
professional_legal_review: NOT_YET_PERFORMED
operational_use: HUMAN_DECISION_REQUIRED
supersedable: true
jurisdiction: Brazil
business_context: B2B_ENGINEERING_CONSULTING
document_id: CFG-LEGAL-CONSUMER-HANDOFF-v1
package: provisional-v1
---

# Consumer handoff — web-cfg #88 e Warmbly #47

Este arquivo vive **dentro** do pacote provisório para não reescrever o `commercial/CONSUMER-HANDOFF.md` já hasheado na autoridade comercial. Não altere os repositórios consumidores nesta campanha.

Consumidores:

| id | papel |
|---|---|
| `web-cfg#88` | delivery parent — preview, futura contratação, checkout **disabled** |
| `Warmbly#47` | reconciliação / aprendizado — eventos de aceite e hashes, nunca receita |

---

## 1. Como pinar o hash

1. Consuma um SHA git de `tjsasakifln/Governance`.
2. Rode:

   ```bash
   python scripts/validate_legal_provisional.py
   python scripts/validate_commercial_authority.py
   ```

3. Grave:
   - `LEGAL AUTHORITY_HASH` impresso pelo validador legal (`sha256:` do `manifest.json` canônico deste diretório);
   - `AUTHORITY_HASH` comercial já usado pelo catálogo (plano de ofertas — **não** substitui o hash legal).
4. Revalide em CI. Hash diferente = pino obsoleto. Não aceite silêncio.
5. Opcional: confira cada linha de `SHA256SUMS.txt` com o hasher embarcado (não reimplemente).

Não copie estes markdowns para um segundo plano de verdade em web-cfg ou Warmbly. Referencie o SHA e o hash.

---

## 2. O que pode aparecer em preview

Somente o bloco **Preview-ok** de `AVISO_LIMITACOES_TECNICAS.md`, mais:

- nome público `CONFENGE - Diagnóstico B2G de Expansão`;
- `offer_code = CFG-DIAG-EXP-v1`;
- `amount_cents = 800000`, `billing_mode = ONE_TIME`;
- lista de entregáveis do catálogo;
- frases de obrigação de meio e ausência de garantia de resultado / representação jurídica.

Preview interno ≠ publicação. `publication_status` do catálogo continua `NOT_PUBLISHED`.

---

## 3. Placeholders que bloqueiam publicação

Se qualquer um destes tokens (ou um valor inventado no lugar deles) aparecer em superfície pública, **não publique**:

```
[[HUMAN_DECISION_REQUIRED: razao_social_cnpj_contratante]]
[[HUMAN_DECISION_REQUIRED: foro]]
[[HUMAN_DECISION_REQUIRED: limite_responsabilidade]]
[[HUMAN_DECISION_REQUIRED: politica_reembolso]]
[[HUMAN_DECISION_REQUIRED: prazo_entrega]]
[[HUMAN_DECISION_REQUIRED: dados_pessoais_tratados]]
[[HUMAN_DECISION_REQUIRED: retencao]]
[[HUMAN_DECISION_REQUIRED: responsavel_fiscal]]
[[HUMAN_DECISION_REQUIRED: aceite_eletronico]]
[[HUMAN_DECISION_REQUIRED: canal_suporte]]
```

Também bloqueiam: `[[PREENCHER_POR_OPERACAO:…]]`, CNPJ/CPF, URL de checkout, chave de provedor, e qualquer menção a exceção comercial privada.

---

## 4. Eventos de aceite a registrar (Warmbly #47 / web-cfg #88)

Quando (e só quando) houver mecanismo humano validado:

| event | significa | não significa |
|---|---|---|
| `terms_presented` | versão/hash exibidos | aceite |
| `terms_hash_pinned` | hash persistido com o lead/OS | pagamento |
| `os_presented` | OS exibida | contrato formado |
| `human_acceptance` | representante aceitou termos+OS+hash | liberação de checkout |
| `financial_confirmation` | pagamento **confirmado** | objeto de provedor criado |
| `mandatory_inputs_received` | insumos mínimos no dossiê | relógio se não houver aceite+pagamento |
| `clock_started` | relógio 10–15 (ou prazo decidido) | recorrência |
| `deliverable_available` | entrega operacional | aceite definitivo de qualidade |
| `correction_round_closed` | rodada única encerrada | novo escopo |
| `terms_invalidated` | hash antigo aposentado | |

`customer_created`, `checkout_created`, `payment_created` **não** são receita e **não** são aceite. Checkout de produção permanece `false`.

Cada evento deve carregar: `offer_code`, `terms_version`, `package_version`, `accepted_hash`, timestamp, identificador do representante (sem colar documento no URL).

---

## 5. Como invalidar termos após mudança

1. Editar qualquer artefato do pacote.
2. `python scripts/validate_legal_provisional.py --write-hashes`.
3. Novo `AUTHORITY_HASH`.
4. Emitir `terms_invalidated` com hash antigo e novo.
5. Preview deve recusar hash antigo.
6. OS já aceita **não** muda retroativamente; recontratação usa a versão nova.

Não edite `CFG-TERMS-B2B-2026-08-17-v1` como se esta campanha o tivesse reaprovado.

---

## 6. Como versionar aceite

Aceite = tupla imutável:

```
(cnpj_cliente, representante, os_id, terms_version, package_hash, accepted_at)
```

Troca de `package_hash` exige novo aceite. Não “atualizar” a tupla no lugar.

---

## 7. Checkout permanece disabled

Enquanto qualquer gate crítico abaixo não estiver decidido **e** o manifesto legal continuar com flags `false`, web-cfg **não** liga checkout, webhook de produção ou mutação real:

- `production_checkout_enabled = false`
- `public_activation_approved = false`
- `real_money_mutation_approved = false`
- `legal_terms_forum != APPROVED` (permanece `UNKNOWN`)
- tokens de `HUMAN_DECISIONS_REQUIRED.md` ainda abertos
- `professional_legal_review = NOT_YET_PERFORMED`

Não leia a existência deste pacote como autorização de produção. O gate jurídico apenas saiu de “nenhum artefato” para `PROVISIONAL_AI_DRAFT`.
