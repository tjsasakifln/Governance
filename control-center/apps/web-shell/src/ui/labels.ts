/**
 * Catálogo de rótulos em português do Control Center.
 *
 * Precedente: `apps/directives-ui/src/ui/labels.ts`. Este módulo é a única
 * fonte de texto visível para enums e códigos técnicos no web-shell.
 *
 * Três regras que o resto da casca depende:
 *
 * 1. **O enum cru nunca sai dos dados.** `data-freshness`, `data-status`,
 *    `data-hop-status`, `data-severity` e companhia continuam carregando o
 *    token original — a sonda Playwright e os testes de contrato leem esses
 *    atributos. Só o texto visível é traduzido.
 * 2. **Nada é apagado.** Todo identificador, nome de schema, locator e enum
 *    cru que sai da superfície principal reaparece em `technicalDetails()`,
 *    recolhido e selecionável para cópia.
 * 3. **Código desconhecido aparece como veio.** Um `code` de texto livre que
 *    o upstream inventou não é traduzido por adivinhação: cai no fallback e
 *    segue visível, porque inventar rótulo esconde dado.
 *
 * O mapa de atualização é semeado por `freshnessLabel` de `../provenance`
 * (`FRESH→fresco`, `STALE→defasado`, `UNKNOWN→desconhecido`,
 * `ERROR→erro de coleta`); ele não é duplicado aqui.
 */
import { escapeHtml } from "../escape";
import { freshnessLabel } from "../provenance";
import type {
  AgentActivityPresentationStatus,
  AgentSessionStatus,
  AttentionSeverity,
  AttentionStatus,
  ClientLifecycle,
  DirectiveKind,
  DirectiveStatus,
  FreshnessStatus,
  HealthStatus,
  PriorityHorizon,
} from "../types";

export { freshnessLabel };

/* ------------------------------------------------------------------ */
/* Ajuda contextual para os conceitos que não têm como sumir da tela.  */
/* ------------------------------------------------------------------ */

export const FRESHNESS_HELP =
  "Atualização é há quanto tempo o dado foi observado. Fresco: dentro da janela esperada. " +
  "Defasado: observado há tempo demais para decidir. Desconhecido: não deu para saber quando. " +
  "Erro de coleta: a leitura falhou.";

export const CONFIDENCE_HELP =
  "Confiança é quanto o dado merece crédito, de 0 a 1. Não é o mesmo que atualização: " +
  "uma observação recente pode ter confiança baixa.";

export const BLOCKED_HELP =
  "Bloqueado é medição impedida, não resultado zero. Falta credencial, configuração ou um " +
  "identificador durável que ligue os dois sistemas.";

export const ABSENT_HELP =
  "Ausente é dado que não chegou. Não é zero e não conta como saudável.";

/** Palavra qualitativa para um número de confiança em [0,1]. */
export function confidenceWord(confidence: number): string {
  if (confidence >= 0.8) return "alta";
  if (confidence >= 0.5) return "média";
  if (confidence > 0) return "baixa";
  return "nenhuma";
}

/* ------------------------------------------------------------------ */
/* Estados                                                             */
/* ------------------------------------------------------------------ */

export const AGENT_STATUS_LABELS: Record<AgentActivityPresentationStatus, string> = {
  RUNNING: "em execução",
  DONE: "concluído",
  PARTIAL: "parcial",
  BLOCKED: "bloqueado",
  FAILED: "falhou",
  UNKNOWN: "desconhecido",
};

export const AGENT_SESSION_STATUS_LABELS: Record<AgentSessionStatus, string> = {
  open: "aberta",
  closed: "encerrada",
  denied: "negada",
};

export const HEALTH_LABELS: Record<HealthStatus, string> = {
  healthy: "saudável",
  degraded: "degradado",
  down: "fora do ar",
  unknown: "desconhecido",
};

export const CLIENT_LIFECYCLE_LABELS: Record<ClientLifecycle, string> = {
  lead: "lead",
  active: "ativo",
  paused: "pausado",
  churn_risk: "risco de saída",
  churned: "saiu",
  unknown: "desconhecido",
};

export const SEVERITY_LABELS: Record<AttentionSeverity, string> = {
  critical: "crítico",
  high: "alto",
  medium: "médio",
  low: "baixo",
};

export const ATTENTION_STATUS_LABELS: Record<AttentionStatus, string> = {
  open: "aberto",
  acknowledged: "reconhecido",
  resolved: "resolvido",
  dismissed: "descartado",
};

export const PRIORITY_HORIZON_LABELS: Record<PriorityHorizon, string> = {
  now: "agora",
  today: "hoje",
  this_week: "esta semana",
};

export const DIRECTIVE_KIND_LABELS: Record<DirectiveKind, string> = {
  decision: "Decisão",
  directive: "Diretiva",
  fact: "Fato",
  constraint: "Restrição",
  priority: "Prioridade",
  risk: "Risco",
  hypothesis: "Hipótese",
};

/** Títulos de seção da Memória: mesmo vocabulário, no plural. */
export const MEMORY_GROUP_TITLES: Record<DirectiveKind, string> = {
  decision: "Decisões",
  directive: "Diretivas",
  fact: "Fatos",
  constraint: "Restrições",
  priority: "Prioridades",
  risk: "Riscos",
  hypothesis: "Hipóteses",
};

export const DIRECTIVE_STATUS_LABELS: Record<DirectiveStatus, string> = {
  draft: "rascunho",
  active: "ativa",
  superseded: "substituída",
  revoked: "revogada",
  expired: "expirada",
};

/**
 * Disponibilidade da origem (`connectors/runner/src/projectors/types.ts`)
 * mais os códigos livres que a superfície comercial recebe do Warmbly.
 */
export const AVAILABILITY_LABELS: Record<string, string> = {
  FRESH: "fresco",
  STALE: "defasado",
  UNKNOWN: "desconhecido",
  ERROR: "erro de coleta",
  NO_DATA: "sem dados",
  NOT_CONFIGURED: "não configurado",
  BLOCKED_BY_SECRET: "bloqueado por credencial ausente",
  UPSTREAM_ERROR: "erro na origem",
  JOIN_UNPROVEN: "cruzamento entre sistemas não comprovado",
  BLOCKED: "bloqueado",
  PRESENT: "presente",
  ABSENT: "ausente",
};

/** Autoridade declarada pelo recorte comercial. */
export const AUTHORITY_LABELS: Record<string, string> = {
  governance: "Governance",
  warmbly: "Warmbly",
  read_model: "modelo de leitura (não escreve)",
  read_model_only: "somente leitura",
};

export const PROVIDER_MUTATION_LABELS: Record<string, string> = {
  forbidden: "proibidas",
  allowed: "permitidas",
};

/**
 * Códigos de exceção comercial. `missing_version` e `orphan` chegam como texto
 * livre do Warmbly — não há enum no backend — então o fallback devolve o
 * código cru em vez de inventar tradução.
 */
export const EXCEPTION_KIND_LABELS: Record<string, string> = {
  exception: "exceção",
  missing_version: "versão de oferta ausente",
  offer_version_drift: "divergência de oferta/versão",
  orphan: "registro órfão",
  orphan_chain: "lead sem negócio vinculado",
  missing_next_action: "sem próxima ação definida",
  stalled_stage: "estágio parado",
  aging: "negócio envelhecido",
  overdue: "em atraso",
  duplicate: "registro duplicado",
};

/**
 * Escopos (`contracts/src/taxonomy.ts SCOPE_LITERALS`). Os prefixados
 * (`repo:<nome>`, `client:<slug>`) mantêm o identificador — ele É o dado —
 * e só ganham a palavra em português na frente.
 */
export const SCOPE_LABELS: Record<string, string> = {
  company: "empresa",
  commercial: "comercial",
  finance: "financeiro",
  clients: "clientes",
  infrastructure: "infraestrutura",
  inbound: "mensagens recebidas",
};

export function scopeLabel(scope: string): string {
  const known = SCOPE_LABELS[scope];
  if (known !== undefined) return known;
  const separator = scope.indexOf(":");
  if (separator > 0) {
    const prefix = scope.slice(0, separator);
    const id = scope.slice(separator + 1);
    if (prefix === "repo") return `repositório ${id}`;
    if (prefix === "client") return `cliente ${id}`;
  }
  return scope;
}

/**
 * Estados de vista do laboratório mock (`view-state.ts VIEW_KINDS`).
 * O valor cru continua no `href` e em `data-view`; só o texto do link muda.
 */
export const VIEW_KIND_LABELS: Record<string, string> = {
  loading: "carregando",
  error: "erro",
  stale: "defasado",
  empty: "vazio",
  ready: "pronto",
};

/**
 * Ações do operador: as três do canal Warmbly
 * (`connectors/warmbly/src/operator/actions.ts`) e as do registro local
 * (`persistence/src/types.ts OPERATOR_ACTION_TYPES`).
 */
export const OPERATOR_ACTION_LABELS: Record<string, string> = {
  pause_dispatch: "pausar disparo",
  resume_dispatch: "retomar disparo",
  acknowledge_inbound_alert: "reconhecer alerta recebido",
  REVIEW_ACTIVITY: "validar atividade",
  ACKNOWLEDGE_EXCEPTION: "reconhecer exceção",
  REOPEN_EXCEPTION: "reabrir exceção",
  CONFIRM_NEXT_ACTION: "confirmar próxima ação",
  REJECT_NEXT_ACTION: "rejeitar próxima ação",
  RECORD_NOTE: "registrar nota",
  MARK_REVIEWED: "marcar como revisado",
  ASSIGN_TRIAGE: "atribuir triagem",
  MARK_TRIAGED: "marcar como triado",
  START_EXCEPTION_WORK: "iniciar tratamento da exceção",
};

/** Desfecho de uma ação do operador (`operator/channel.ts`). */
export const OPERATOR_OUTCOME_LABELS: Record<string, string> = {
  executed: "executada",
  challenged: "aguardando confirmação",
  refused: "recusada",
  unknown: "sem resposta do Warmbly",
  accepted: "aceita",
  rejected: "rejeitada",
  duplicate: "duplicada",
};

/* ------------------------------------------------------------------ */
/* Consultas tolerantes: valor desconhecido volta como veio.           */
/* ------------------------------------------------------------------ */

function lookup(table: Record<string, string>, value: string): string {
  return table[value] ?? value;
}

export function agentStatusLabel(status: string): string {
  return lookup(AGENT_STATUS_LABELS as Record<string, string>, status);
}

export function agentSessionStatusLabel(status: string): string {
  return lookup(AGENT_SESSION_STATUS_LABELS as Record<string, string>, status);
}

export function healthLabel(status: string): string {
  return lookup(HEALTH_LABELS as Record<string, string>, status);
}

export function clientLifecycleLabel(lifecycle: string): string {
  return lookup(CLIENT_LIFECYCLE_LABELS as Record<string, string>, lifecycle);
}

export function severityLabel(severity: string): string {
  return lookup(SEVERITY_LABELS as Record<string, string>, severity);
}

export function attentionStatusLabel(status: string): string {
  return lookup(ATTENTION_STATUS_LABELS as Record<string, string>, status);
}

export function priorityHorizonLabel(horizon: string): string {
  return lookup(PRIORITY_HORIZON_LABELS as Record<string, string>, horizon);
}

export function directiveKindLabel(kind: string): string {
  return lookup(DIRECTIVE_KIND_LABELS as Record<string, string>, kind);
}

export function directiveStatusLabel(status: string): string {
  return lookup(DIRECTIVE_STATUS_LABELS as Record<string, string>, status);
}

export function availabilityLabel(value: string): string {
  return lookup(AVAILABILITY_LABELS, value);
}

export function authorityLabel(value: string): string {
  return lookup(AUTHORITY_LABELS, value);
}

export function providerMutationLabel(value: string): string {
  return lookup(PROVIDER_MUTATION_LABELS, value);
}

export function exceptionKindLabel(kind: string): string {
  return lookup(EXCEPTION_KIND_LABELS, kind);
}

export function viewKindLabel(kind: string): string {
  return lookup(VIEW_KIND_LABELS, kind);
}

export function operatorActionLabel(action: string): string {
  return lookup(OPERATOR_ACTION_LABELS, action);
}

export function operatorOutcomeLabel(outcome: string): string {
  return lookup(OPERATOR_OUTCOME_LABELS, outcome);
}

/**
 * Estado de um hop do funil. Aceita tanto os enums de atualização quanto
 * `BLOCKED`/`UNKNOWN`, que é o que `hopStatusFor` produz.
 */
export function hopStatusLabel(status: string): string {
  return lookup(AVAILABILITY_LABELS, status);
}

/* ------------------------------------------------------------------ */
/* Renderizadores de rótulo                                            */
/* ------------------------------------------------------------------ */

/**
 * Termo com ajuda contextual. O texto de ajuda vai em `title` (dica do
 * navegador) e em `data-help` — assim um teste consegue afirmar que a ajuda
 * existe sem depender de hover.
 */
export function helpTerm(term: string, help: string): string {
  return `<span class="term" data-help="${escapeHtml(help)}" title="${escapeHtml(help)}">${escapeHtml(term)}</span>`;
}

/**
 * Pílula de estado. O texto visível é português; o token cru fica em
 * `data-raw`, e daí para o bloco de detalhe técnico.
 */
export function statusPill(raw: string, label: string, extraClass = ""): string {
  const cls = ["pill", extraClass].filter((part) => part.length > 0).join(" ");
  return `<span class="${escapeHtml(cls)}" data-raw="${escapeHtml(raw)}">${escapeHtml(label)}</span>`;
}

/**
 * Pílula de atualização. Carrega a ajuda contextual em `title`/`data-help`
 * porque "atualização" é um dos conceitos que a issue exige explicar em toda
 * superfície onde aparece, e ela aparece em quase todas.
 */
export function freshnessPill(status: FreshnessStatus): string {
  return `<span class="pill pill-${escapeHtml(status.toLowerCase())}" data-raw="${escapeHtml(status)}" data-help="${escapeHtml(FRESHNESS_HELP)}" title="${escapeHtml(FRESHNESS_HELP)}">${escapeHtml(freshnessLabel(status))}</span>`;
}

/* ------------------------------------------------------------------ */
/* Detalhe técnico progressivo                                         */
/* ------------------------------------------------------------------ */

export interface TechnicalFact {
  /** Rótulo em português da linha. */
  readonly term: string;
  /** Valor cru — identificador, enum, schema, locator. Nunca traduzido. */
  readonly value: string;
}

const TECHNICAL_SUMMARY = "Detalhe técnico";

/**
 * Bloco recolhido com os identificadores que saíram da superfície principal.
 *
 * O `<pre>` no fim repete tudo em `chave=valor`, uma linha por fato: é o que
 * torna o bloco copiável sem depender de JavaScript — a casca re-liga todos
 * os handlers a cada repintura (`app.ts`), então um botão de cópia morreria
 * na primeira navegação.
 *
 * Linhas sem valor são descartadas: um detalhe técnico cheio de `—` não é
 * detalhe, é ruído.
 */
export function technicalDetails(facts: readonly TechnicalFact[], name = ""): string {
  const rows = facts.filter((row) => row.value.length > 0);
  if (rows.length === 0) return "";
  const items = rows
    .map(
      (row) =>
        `<div><dt>${escapeHtml(row.term)}</dt><dd><code>${escapeHtml(row.value)}</code></dd></div>`,
    )
    .join("");
  const copyable = rows.map((row) => `${row.term}=${row.value}`).join("\n");
  const attr = name.length > 0 ? ` data-tech="${escapeHtml(name)}"` : "";
  return `<details class="tech"${attr}><summary>${TECHNICAL_SUMMARY}</summary><dl class="tech-facts">${items}</dl><pre class="tech-copy" tabindex="0">${escapeHtml(copyable)}</pre></details>`;
}
