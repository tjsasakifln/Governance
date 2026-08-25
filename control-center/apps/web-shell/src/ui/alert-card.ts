import type { AlertPresentation } from "../alerts";
import { escapeHtml } from "../escape";
import { freshnessLabel, sourcePresentationLabel } from "../provenance";
import type { FreshnessStatus, Provenance } from "../types";
import { provenanceBlock } from "./provenance";

/**
 * The two halves of an alert card.
 *
 * `alertFront` may only read typed fields of {@link AlertPresentation}; the
 * engine prose lives in `alertWhy`, inside a closed `<details>`. Keeping the
 * two functions apart is what makes "no formula on the front" checkable.
 */

export function severityPill(alert: AlertPresentation): string {
  return `<span class="pill pill-severity" data-severity-pill="${escapeHtml(alert.severity)}">${escapeHtml(alert.severity_label)}</span>`;
}

export function classPill(alert: AlertPresentation): string {
  return `<span class="pill pill-class" data-alert-class-pill="${escapeHtml(alert.klass)}">${escapeHtml(alert.klass_label)}</span>`;
}

export function freshnessPill(status: FreshnessStatus): string {
  return `<span class="pill pill-${escapeHtml(status.toLowerCase())}" data-raw="${escapeHtml(status)}">${escapeHtml(freshnessLabel(status))}</span>`;
}

function fact(term: string, value: string, extra = ""): string {
  return `<div><dt>${escapeHtml(term)}</dt><dd>${value}${extra}</dd></div>`;
}

function acknowledgeForm(alert: AlertPresentation): string {
  const ack = alert.acknowledge;
  if (!ack) return "";
  return `
        <form data-operator-form="${escapeHtml(ack.action_type)}" data-interaction="today.acknowledge" data-one-decision="true" class="operator-form alert-ack">
          <input type="hidden" name="target_canonical_id" value="${escapeHtml(ack.target_canonical_id)}" />
          <input type="hidden" name="target_source_id" value="${escapeHtml(ack.target_source_id)}" />
          <button type="submit">Reconhecer sem resolver</button>
          <p class="hint" data-ack-effect="control-center-only">${escapeHtml(ack.effect)}</p>
        </form>`;
}

/**
 * Front of the card: severity in Portuguese, impact, origin, owner, age,
 * deadline and the next safe step. No scoring token reaches this string.
 */
export function alertFront(alert: AlertPresentation, provenance: Provenance): string {
  const description =
    alert.description.length > 0
      ? `<p class="alert-description">${escapeHtml(alert.description)}</p>`
      : "";
  return `
      <p class="kicker">${severityPill(alert)} ${classPill(alert)} ${freshnessPill(provenance.freshness_status)}</p>
      <p class="alert-impact"><strong>Impacto:</strong> ${escapeHtml(alert.impact)}</p>
      ${description}
      <dl class="facts alert-facts">
        ${fact("Origem", escapeHtml(sourcePresentationLabel(provenance.source)))}
        ${fact(
          "Responsável",
          `<a href="${escapeHtml(alert.owner.href)}" data-owner-destination="${escapeHtml(alert.owner.destination)}">${escapeHtml(alert.owner.label)}</a>`,
          `<span class="hint">${escapeHtml(alert.owner_note)}</span>`,
        )}
        ${fact(
          "Idade",
          `${escapeHtml(alert.age_label)}<span class="sr-only">detectado em UTC ${escapeHtml(alert.detected_at)}</span>`,
        )}
        ${fact("Prazo", `<span data-deadline-overdue="${alert.deadline.overdue ? "true" : "false"}">${escapeHtml(alert.deadline.label)}</span>`)}
      </dl>
      <div class="alert-next" data-alert-next="${escapeHtml(alert.id)}">
        <p class="alert-next-title">O que fazer agora</p>
        <p class="alert-next-step">${escapeHtml(alert.next_step)}</p>
        <p><a class="alert-open" href="${escapeHtml(alert.next_step_href)}">${escapeHtml(alert.next_step_label)}</a></p>
        ${acknowledgeForm(alert)}
      </div>`;
}

/**
 * "Como foi priorizado": everything the attention engine says about the score.
 * Closed by default — this is the only place `peso_categoria`, `freshness_bp`,
 * `confidence_bp` and the KILL-RULE banner are allowed to appear.
 */
export function alertWhy(alert: AlertPresentation, provenance: Provenance): string {
  const notes: string[] = [];
  if (alert.forced_by_kill_rule) {
    notes.push(
      "Regra fixa de risco crítico (KILL-RULE): entra em atenção agora independentemente da pontuação.",
    );
  }
  if (alert.merge_count !== null && alert.merge_count > 1) {
    notes.push(`Sinal mesclado a partir de ${alert.merge_count} observações correlacionadas.`);
  }
  const noteBlock =
    notes.length > 0
      ? `<ul class="alert-why-notes">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
      : "";
  const breakdown =
    alert.breakdown.length > 0
      ? `<p class="alert-formula">${escapeHtml(alert.breakdown)}</p>`
      : `<p class="alert-formula">Sem fórmula de priorização registrada para este item.</p>`;
  const evidence =
    alert.evidence.length > 0
      ? `<ul class="alert-evidence">${alert.evidence
          .map((locator) => `<li><span class="locator">${escapeHtml(locator)}</span></li>`)
          .join("")}</ul>`
      : "";
  return `
      <details class="alert-why" data-alert-why="${escapeHtml(alert.id)}">
        <summary>Como foi priorizado</summary>
        ${noteBlock}
        ${breakdown}
        ${evidence}
        ${provenanceBlock(provenance)}
      </details>`;
}

export function alertBody(alert: AlertPresentation, provenance: Provenance): string {
  return `${alertFront(alert, provenance)}${alertWhy(alert, provenance)}`;
}

/** Attributes every alert-bearing element carries so a probe can tell classes apart. */
export function alertDataAttributes(alert: AlertPresentation): string {
  return `data-id="${escapeHtml(alert.id)}" data-severity="${escapeHtml(alert.severity)}" data-alert-class="${escapeHtml(alert.klass)}"`;
}
