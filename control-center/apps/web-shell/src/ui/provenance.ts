import { escapeHtml } from "../escape";
import { mapProvenance, type ProvenancePresentation } from "../provenance";
import type { Provenance } from "../types";
import { freshnessTone } from "../freshness-tone";

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
        <dt>Freshness</dt>
        <dd>
          <span class="pill pill-${escapeHtml(p.freshnessStatus.toLowerCase())}">${escapeHtml(p.freshnessStatus)} · ${escapeHtml(p.freshnessLabel)}</span>
          <span class="sr-only">${escapeHtml(p.freshnessStatus)}</span>
        </dd>
      </div>
      <div>
        <dt>Confiança</dt>
        <dd>${escapeHtml(p.confidenceLabel)}</dd>
      </div>
    </dl>
  `;
}
