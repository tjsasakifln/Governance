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
 * 3. **Código desconhecido não vira texto de interface.** Um valor novo recebe
 *    um rótulo autoral honesto (“estado não reconhecido” e equivalentes); o
 *    token original continua disponível somente nos dados e no detalhe técnico.
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
 * livre do Warmbly, mas valores novos ainda usam um fallback autoral seguro.
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
};

/** Desfecho de uma ação do operador (`operator/channel.ts`). */
export const OPERATOR_OUTCOME_LABELS: Record<string, string> = {
  executed: "executada",
  challenged: "aguardando confirmação",
  refused: "recusada",
  failed: "falhou",
  unknown: "sem resposta do Warmbly",
  accepted: "aceita",
  rejected: "rejeitada",
  duplicate: "duplicada",
};

/**
 * Valores que o projetor comercial realmente publica em `operations.activity`.
 * O token continua em `data-*` e no detalhe técnico; esta tabela cuida apenas
 * da leitura humana.
 */
export const COMMERCIAL_EVENT_LABELS: Record<string, string> = {
  activity: "atividade",
  overdue_task: "tarefa atrasada",
  next_action: "próxima ação",
  stalled_deal: "negócio parado",
  exception_state: "estado excepcional",
  inbox_signal: "sinal da caixa de entrada",
  campaign_signal: "sinal de campanha",
  inbound_lead: "lead recebido",
  confenge_attention: "atenção da CONFENGE",
  open: "abertura",
  pending: "tarefa pendente",
  in_progress: "tarefa em andamento",
  completed: "tarefa concluída",
  cancelled: "tarefa cancelada",
  new: "novo contato",
  unread: "mensagem não lida",
  awaiting_reply: "aguardando resposta",
  awaiting_agent_draft: "aguardando revisão do rascunho",
  replied: "resposta recebida",
  dnc: "contato proibido",
  do_not_contact: "contato proibido",
  needs_attention: "exige atenção",
  scheduled_pending: "agendamento pendente",
  snoozed: "adiado",
  ready: "pronto",
  active: "atividade ativa",
  paused: "atividade pausada",
  handled: "atividade tratada",
  done: "atividade concluída",
  closed: "encerramento",
  won: "negócio ganho",
  lost: "negócio perdido",
  failed: "falha",
  error: "erro",
  unknown: "atividade desconhecida",
};

/** Estados de negócio, tarefa e caixa de entrada emitidos pelo Warmbly. */
export const COMMERCIAL_STATE_LABELS: Record<string, string> = {
  open: "aberto",
  pending: "pendente",
  in_progress: "em andamento",
  completed: "concluído",
  cancelled: "cancelado",
  new: "novo",
  unread: "não lido",
  awaiting_reply: "aguardando resposta",
  awaiting_agent_draft: "aguardando revisão do rascunho",
  replied: "respondido",
  dnc: "não contatar",
  do_not_contact: "não contatar",
  needs_attention: "exige atenção",
  scheduled_pending: "agendamento pendente",
  snoozed: "adiado",
  ready: "pronto",
  active: "ativo",
  paused: "pausado",
  handled: "tratado",
  done: "concluído",
  closed: "encerrado",
  won: "ganho",
  lost: "perdido",
  failed: "falhou",
  error: "falhou",
  acknowledged: "reconhecido",
  resolved: "resolvido",
  dismissed: "descartado",
  unknown: "desconhecido",
};

/** Estágios conhecidos; qualquer valor novo segue o fallback seguro abaixo. */
export const PIPELINE_STAGE_LABELS: Record<string, string> = {
  ...COMMERCIAL_STATE_LABELS,
  Proposta: "Proposta",
  proposta: "proposta",
  qualified: "qualificado",
  qualification: "qualificação",
  discovery: "descoberta",
  proposal: "proposta",
  negotiation: "negociação",
  closed_won: "encerrado como ganho",
  closed_lost: "encerrado como perdido",
};

export const UNRECOGNIZED_COMMERCIAL_STATE_LABEL = "estado não reconhecido";

export const ROUTE_CLASS_LABELS: Record<string, string> = {
  DIRECT_PERSON: "pessoa identificada diretamente",
  DIRECT_COMPANY: "empresa identificada diretamente",
  INBOUND: "mensagem recebida",
  UNKNOWN: "classe de rota desconhecida",
};

export const PROVIDER_LABELS: Record<string, string> = {
  smtp: "SMTP",
  warmbly: "Warmbly",
  UNKNOWN: "provedor desconhecido",
};

export const AUTHORIZATION_STATE_LABELS: Record<string, string> = {
  active: "ativa",
  authorized: "autorizada",
  revoked: "revogada",
  expired: "expirada",
  pending: "pendente",
  UNKNOWN: "desconhecida",
};

export const GO_REVIEW_VERDICT_LABELS: Record<string, string> = {
  GO: "aprovado para prosseguir",
  NO_GO: "não aprovado",
  approved: "aprovado para prosseguir",
  rejected: "não aprovado",
  pending: "pendente",
  UNKNOWN: "desconhecido",
};

export const DISPATCH_STATE_LABELS: Record<string, string> = {
  ACTIVE: "ativo",
  PAUSED: "pausado",
  UNKNOWN: "desconhecido",
  active: "ativo",
  paused: "pausado",
  blocked_outside_window: "bloqueado fora da janela de envio",
  blocked: "bloqueado",
  ready: "pronto",
};

/* ------------------------------------------------------------------ */
/* Consultas tolerantes: cada catálogo define seu fallback seguro.     */
/* ------------------------------------------------------------------ */

function lookup(table: Record<string, string>, value: string, fallback: string): string {
  return table[value] ?? fallback;
}

export function agentStatusLabel(status: string): string {
  return lookup(AGENT_STATUS_LABELS as Record<string, string>, status, "estado do agente não reconhecido");
}

export function agentSessionStatusLabel(status: string): string {
  return lookup(AGENT_SESSION_STATUS_LABELS as Record<string, string>, status, "estado da sessão não reconhecido");
}

export function healthLabel(status: string): string {
  return lookup(HEALTH_LABELS as Record<string, string>, status, "estado de saúde não reconhecido");
}

export function clientLifecycleLabel(lifecycle: string): string {
  return lookup(CLIENT_LIFECYCLE_LABELS as Record<string, string>, lifecycle, "ciclo do cliente não reconhecido");
}

export function severityLabel(severity: string): string {
  return lookup(SEVERITY_LABELS as Record<string, string>, severity, "gravidade não reconhecida");
}

export function attentionStatusLabel(status: string): string {
  return lookup(ATTENTION_STATUS_LABELS as Record<string, string>, status, "estado de atenção não reconhecido");
}

export function priorityHorizonLabel(horizon: string): string {
  return lookup(PRIORITY_HORIZON_LABELS as Record<string, string>, horizon, "horizonte não reconhecido");
}

export function directiveKindLabel(kind: string): string {
  return lookup(DIRECTIVE_KIND_LABELS as Record<string, string>, kind, "tipo de diretiva não reconhecido");
}

export function directiveStatusLabel(status: string): string {
  return lookup(DIRECTIVE_STATUS_LABELS as Record<string, string>, status, "estado da diretiva não reconhecido");
}

export function availabilityLabel(value: string): string {
  return lookup(AVAILABILITY_LABELS, value, "disponibilidade não reconhecida");
}

export function authorityLabel(value: string): string {
  return lookup(AUTHORITY_LABELS, value, "autoridade não reconhecida");
}

export function providerMutationLabel(value: string): string {
  return lookup(PROVIDER_MUTATION_LABELS, value, "regra de mutação não reconhecida");
}

export function exceptionKindLabel(kind: string): string {
  return EXCEPTION_KIND_LABELS[kind] ?? "tipo não reconhecido";
}

export function viewKindLabel(kind: string): string {
  return lookup(VIEW_KIND_LABELS, kind, "estado da vista não reconhecido");
}

export function operatorActionLabel(action: string): string {
  return lookup(OPERATOR_ACTION_LABELS, action, "ação não reconhecida");
}

export function operatorOutcomeLabel(outcome: string): string {
  return lookup(OPERATOR_OUTCOME_LABELS, outcome, "resultado não reconhecido");
}

export function commercialEventLabel(event: string): string {
  return (
    COMMERCIAL_EVENT_LABELS[event] ??
    COMMERCIAL_EVENT_LABELS[event.toLowerCase()] ??
    UNRECOGNIZED_COMMERCIAL_STATE_LABEL
  );
}

export function commercialStateLabel(state: string): string {
  return (
    COMMERCIAL_STATE_LABELS[state] ??
    COMMERCIAL_STATE_LABELS[state.toLowerCase()] ??
    UNRECOGNIZED_COMMERCIAL_STATE_LABEL
  );
}

export function pipelineStageLabel(stage: string): string {
  return (
    PIPELINE_STAGE_LABELS[stage] ??
    PIPELINE_STAGE_LABELS[stage.toLowerCase()] ??
    UNRECOGNIZED_COMMERCIAL_STATE_LABEL
  );
}

export function routeClassLabel(value: string): string {
  return ROUTE_CLASS_LABELS[value] ?? "classe de rota não reconhecida";
}

export function providerLabel(value: string): string {
  return PROVIDER_LABELS[value] ?? "provedor não reconhecido";
}

export function authorizationStateLabel(value: string): string {
  return AUTHORIZATION_STATE_LABELS[value] ?? UNRECOGNIZED_COMMERCIAL_STATE_LABEL;
}

export function goReviewVerdictLabel(value: string): string {
  return GO_REVIEW_VERDICT_LABELS[value] ?? "veredito não reconhecido";
}

export function dispatchStateLabel(value: string): string {
  return DISPATCH_STATE_LABELS[value] ?? UNRECOGNIZED_COMMERCIAL_STATE_LABEL;
}

/**
 * Estado de um hop do funil. Aceita tanto os enums de atualização quanto
 * `BLOCKED`/`UNKNOWN`, que é o que `hopStatusFor` produz.
 */
export function hopStatusLabel(status: string): string {
  return lookup(AVAILABILITY_LABELS, status, "estado não reconhecido");
}

/* ------------------------------------------------------------------ */
/* Renderizadores de rótulo                                            */
/* ------------------------------------------------------------------ */

/**
 * Termo com ajuda contextual. `details/summary` oferece o mesmo conteúdo a
 * mouse, teclado e toque sem depender de JavaScript ou de hover.
 */
export function helpTerm(term: string, help: string): string {
  return `<details class="term-help"><summary class="term" data-help="${escapeHtml(help)}" title="${escapeHtml(help)}">${escapeHtml(term)}<span class="sr-only"> — abrir ajuda contextual</span></summary><span class="term-help-text" role="note">${escapeHtml(help)}</span></details>`;
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
 * Pílula de atualização com a mesma divulgação nativa acessível de
 * `helpTerm()`. O enum cru permanece em `data-raw`.
 */
export function freshnessPill(status: FreshnessStatus): string {
  return `<details class="term-help freshness-help"><summary class="pill pill-${escapeHtml(status.toLowerCase())}" data-raw="${escapeHtml(status)}" data-help="${escapeHtml(FRESHNESS_HELP)}" title="${escapeHtml(FRESHNESS_HELP)}">${escapeHtml(freshnessLabel(status))}<span class="sr-only"> — abrir ajuda sobre atualização</span></summary><span class="term-help-text" role="note">${escapeHtml(FRESHNESS_HELP)}</span></details>`;
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
