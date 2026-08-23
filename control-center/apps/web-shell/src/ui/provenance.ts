import { escapeHtml } from "../escape";
import { mapProvenance, type ProvenancePresentation } from "../provenance";
import type { Provenance } from "../types";
import { freshnessTone } from "../freshness-tone";
import {
  CONFIDENCE_HELP,
  FRESHNESS_HELP,
  confidenceWord,
  freshnessPill,
  helpTerm,
  technicalDetails,
} from "./labels";

/**
 * Provenance na superfície principal: quem observou, quando, quão atual e
 * quanto merece crédito — tudo em português.
 *
 * O que é identificador (sistema, tipo de origem, locator, o enum cru de
 * atualização, o carimbo UTC) desce para o bloco recolhido. Nada some:
 * `data-freshness`, `data-tone` e `data-source` continuam com o valor cru,
 * porque a sonda Playwright e os testes de tom leem esses atributos.
 */
export function provenanceBlock(provenance: Provenance): string {
  const p: ProvenancePresentation = mapProvenance(provenance);
  const tone = freshnessTone(p.freshnessStatus);
  return `
    <dl class="prov" data-freshness="${escapeHtml(p.freshnessStatus)}" data-tone="${tone}" data-source="${escapeHtml(p.sourceSystem)}">
      <div>
        <dt>Origem</dt>
        <dd>${escapeHtml(p.sourceLabel)}</dd>
      </div>
      <div>
        <dt>Observado</dt>
        <dd>
          <time datetime="${escapeHtml(p.observedAtUtc)}">${escapeHtml(p.observedAtLocal)}</time>
          <span class="sr-only">UTC ${escapeHtml(p.observedAtUtc)}</span>
        </dd>
      </div>
      <div>
        <dt>${helpTerm("Atualização", FRESHNESS_HELP)}</dt>
        <dd>
          ${freshnessPill(p.freshnessStatus)}
          <span class="sr-only">${escapeHtml(p.freshnessLabel)}</span>
        </dd>
      </div>
      <div>
        <dt>${helpTerm("Confiança", CONFIDENCE_HELP)}</dt>
        <dd>${escapeHtml(`${confidenceWord(p.confidence)} (${p.confidenceLabel.replace("confiança ", "")})`)}</dd>
      </div>
    </dl>
    ${technicalDetails(
      [
        { term: "sistema", value: p.sourceSystem },
        { term: "tipo_de_origem", value: p.sourceKind },
        { term: "locator", value: p.sourceLocator },
        { term: "freshness_status", value: p.freshnessStatus },
        { term: "observed_at_utc", value: p.observedAtUtc },
        { term: "confidence", value: p.confidence.toFixed(2) },
      ],
      "provenance",
    )}
  `;
}
