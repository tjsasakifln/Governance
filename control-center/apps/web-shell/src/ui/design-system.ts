import { escapeHtml } from "../escape";
import { technicalDetails } from "./labels";

export const OPERATIONAL_STATE_IDS = [
  "critical",
  "alert",
  "success",
  "unknown",
  "stale",
  "blocked",
  "loading",
  "empty",
] as const;

export type OperationalState = (typeof OPERATIONAL_STATE_IDS)[number];

export interface OperationalStateDefinition {
  readonly label: string;
  readonly symbol: string;
  readonly legacyClass: "error" | "stale" | "ok" | "loading" | "empty";
  readonly defaultRole: "alert" | "status";
}

export const OPERATIONAL_STATES: Readonly<Record<OperationalState, OperationalStateDefinition>> = {
  critical: { label: "Crítico", symbol: "!", legacyClass: "error", defaultRole: "alert" },
  alert: { label: "Atenção", symbol: "▲", legacyClass: "stale", defaultRole: "status" },
  success: { label: "Confirmado", symbol: "✓", legacyClass: "ok", defaultRole: "status" },
  unknown: { label: "Desconhecido", symbol: "?", legacyClass: "empty", defaultRole: "status" },
  stale: { label: "Defasado", symbol: "↻", legacyClass: "stale", defaultRole: "status" },
  blocked: { label: "Bloqueado", symbol: "×", legacyClass: "error", defaultRole: "alert" },
  loading: { label: "Em andamento", symbol: "…", legacyClass: "loading", defaultRole: "status" },
  empty: { label: "Sem itens", symbol: "○", legacyClass: "empty", defaultRole: "status" },
};

export const OPERATIONAL_COMPONENT_CONTRACT = [
  { id: "page-header", selector: "[data-operational-component='page-header']", owner: "ui/render.ts" },
  { id: "state-summary", selector: "[data-operational-component='state-summary']", owner: "ui/orientation.ts" },
  { id: "priority", selector: ".priority", owner: "ui/hoje.ts + ui/render.ts" },
  { id: "action-bar", selector: "[data-operational-component='action-bar']", owner: "ui/orientation.ts" },
  { id: "queue-item", selector: "[data-review-list-item]", owner: "ui/domains.ts" },
  { id: "form", selector: ".operator-form, .shortcut-form", owner: "real write forms" },
  { id: "feedback", selector: "[data-operational-component='feedback']", owner: "ui/design-system.ts" },
  { id: "view-state", selector: "[data-view-state] [data-operational-component='feedback']", owner: "ui/render.ts" },
  { id: "technical-detail", selector: ".tech", owner: "ui/labels.ts" },
  { id: "confirmation", selector: "[data-confirmation-pending], [data-operational-confirmation]", owner: "ui/warmbly.ts" },
] as const;

function dataAttributes(data: Readonly<Record<string, string>> | undefined): string {
  if (!data) return "";
  return Object.entries(data)
    .map(([key, value]) => {
      if (!/^[a-z][a-z0-9-]*$/.test(key)) {
        throw new Error(`invalid operational data attribute: ${key}`);
      }
      return ` data-${key}="${escapeHtml(value)}"`;
    })
    .join("");
}

function fragmentHref(value: string): string {
  if (!value.startsWith("#")) {
    throw new Error("operational actions must target a shell fragment");
  }
  return escapeHtml(value);
}

export function operationalFeedback(input: {
  readonly state: OperationalState;
  readonly title: string;
  readonly body?: string;
  readonly detailHtml?: string;
  readonly className?: string;
  readonly role?: "alert" | "status" | "note";
  readonly data?: Readonly<Record<string, string>>;
}): string {
  const definition = OPERATIONAL_STATES[input.state];
  if (input.className && !/^[a-z0-9 _-]+$/i.test(input.className)) {
    throw new Error("invalid operational feedback class name");
  }
  const classes = ["banner", definition.legacyClass, "operational-feedback", input.className]
    .filter(Boolean)
    .join(" ");
  return `<div class="${classes}" data-operational-component="feedback" data-operational-state="${input.state}" role="${input.role ?? definition.defaultRole}"${dataAttributes(input.data)}>
    <p class="operational-feedback-heading"><span class="operational-feedback-state"><span aria-hidden="true">${definition.symbol}</span> ${definition.label}</span><strong>${escapeHtml(input.title)}</strong></p>
    ${input.body ? `<p class="operational-feedback-body">${escapeHtml(input.body)}</p>` : ""}
    ${input.detailHtml ?? ""}
  </div>`;
}

export function operationalPageHeader(title: string, summary: string): string {
  return `<header class="page-head" data-operational-component="page-header">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(summary)}</p>
  </header>`;
}

export function operationalActionBar(input: {
  readonly label: string;
  readonly primary?: { readonly label: string; readonly href: string };
  readonly secondary?: readonly { readonly label: string; readonly href: string }[];
  readonly guidance?: string;
  readonly primaryClassName?: string;
  readonly primaryData?: Readonly<Record<string, string>>;
}): string {
  const secondary = input.secondary ?? [];
  return `<div class="operational-action-bar" data-operational-component="action-bar" data-primary-actions="${input.primary ? "1" : "0"}" aria-label="${escapeHtml(input.label)}">
    ${input.primary ? `<a class="operational-primary-action ${escapeHtml(input.primaryClassName ?? "")}" href="${fragmentHref(input.primary.href)}"${dataAttributes(input.primaryData)}>${escapeHtml(input.primary.label)}</a>` : ""}
    ${secondary.map((action) => `<a class="operational-secondary-action" href="${fragmentHref(action.href)}">${escapeHtml(action.label)}</a>`).join("")}
    ${input.guidance ? `<p class="operational-action-guidance">${escapeHtml(input.guidance)}</p>` : ""}
  </div>`;
}

export function renderOperationalComponentCatalog(): string {
  const longText = "Texto longo de fixture: confirme a origem, o horário observado e a autoridade antes de repetir qualquer ação; ausência de dado nunca equivale a zero ou sucesso.";
  const feedback = OPERATIONAL_STATE_IDS.map((state) => operationalFeedback({
    state,
    title: `${OPERATIONAL_STATES[state].label}: estado extremo`,
    body: state === "unknown" ? "Dado ausente; valor e diagnóstico não foram inferidos." : longText,
  })).join("");
  return `<section class="component-catalog" data-operational-catalog="v1" aria-labelledby="component-catalog-title">
    ${operationalPageHeader("Catálogo operacional", "Fixtures reais do sistema visual em estados extremos, textos longos e dados ausentes.")}
    <section class="orientation-summary" data-operational-component="state-summary" aria-labelledby="catalog-summary-title">
      <h2 id="catalog-summary-title">Resumo de estado</h2>
      <p><strong>Estado:</strong> leitura parcial. <strong>Risco:</strong> desconhecido. <strong>Próxima ação:</strong> confirmar a origem.</p>
    </section>
    <section aria-labelledby="catalog-feedback-title"><h2 id="catalog-feedback-title">Feedback e estados</h2><div class="component-catalog-grid" data-view-state="loading">${feedback}</div></section>
    <section aria-labelledby="catalog-priority-title"><h2 id="catalog-priority-title">Prioridade e fila</h2>
      <article class="card priority" data-operational-component="priority"><p class="kicker"><span class="pill">Prioridade 1</span></p><h3>Resolver identidade ausente sem inventar cliente</h3><p>${longText}</p></article>
      <ul class="review-queue" aria-label="Fila de revisão extrema"><li class="review-queue-item" data-review-list-item="catalog-long"><strong>Mensagem com destinatário ausente</strong><p>${longText}</p></li></ul>
    </section>
    <section aria-labelledby="catalog-action-title"><h2 id="catalog-action-title">Ação, formulário e confirmação</h2>
      ${operationalActionBar({ label: "Ações da fixture", primary: { label: "Confirmar leitura", href: "#catalog-form" }, secondary: [{ label: "Voltar à evidência", href: "#catalog-detail" }] })}
      <form id="catalog-form" class="operator-form"><label>Motivo obrigatório<textarea name="reason" required rows="3">Confirmar origem e autoridade antes da decisão.</textarea></label><button type="submit">Registrar decisão de fixture</button></form>
      <div class="banner stale" role="status" data-operational-confirmation="true"><strong>Confirmação pendente.</strong> Nada foi executado; releia o alvo antes de confirmar.</div>
    </section>
    <section id="catalog-detail" aria-labelledby="catalog-detail-title"><h2 id="catalog-detail-title">Dado, diagnóstico e evidência</h2>
      <dl class="facts"><div><dt>Dado</dt><dd>ausente</dd></div><div><dt>Diagnóstico</dt><dd>identidade não comprovada</dd></div><div><dt>Evidência</dt><dd>nenhum identificador canônico recebido</dd></div></dl>
      ${technicalDetails([{ term: "fixture", value: "missing-canonical-id" }, { term: "raw_state", value: "UNKNOWN" }], "component-catalog")}
    </section>
  </section>`;
}
