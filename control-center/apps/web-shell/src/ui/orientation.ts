import type { DestinationPage } from "../adapters/contract";
import { formatLocal, isUtcDateTime } from "../datetime";
import { getDestination, type DestinationId } from "../destinations";
import { escapeHtml } from "../escape";
import { collectProvenance } from "../page";
import type { AttentionItem, FreshnessStatus, PriorityRecommendation } from "../types";
import type { ViewKind, ViewState } from "../view-state";
import { severityLabel } from "./labels";

export const ORIENTATION_FIELDS = ["state", "risk", "next-action"] as const;

export type OrientationField = (typeof ORIENTATION_FIELDS)[number];
export type OrientationTone = "ok" | "attention" | "critical" | "unknown" | "neutral";
export type OrientationActionKind = "act" | "recover" | "wait" | "none";

export interface OrientationStatement {
  readonly label: string;
  readonly detail: string;
  readonly tone: OrientationTone;
}

export interface OrientationAction {
  readonly label: string;
  readonly detail: string;
  readonly kind: OrientationActionKind;
  readonly href: string | null;
}

export interface OrientationSummary {
  readonly destination: DestinationId;
  readonly locationLabel: string;
  readonly viewKind: ViewKind;
  readonly state: OrientationStatement;
  readonly risk: OrientationStatement;
  readonly action: OrientationAction;
  readonly observedAt: string | null;
  readonly observedAtLabel: string;
}

interface OrientationInput {
  readonly destination: DestinationId;
  readonly view: ViewState<DestinationPage>;
  readonly surface?: string | null;
  readonly currentHref?: string;
}

const commercialSurfaceLabels: Readonly<Record<string, string>> = {
  visao: "Visão",
  rascunhos: "Revisão editorial",
  cohorts: "Coortes",
  atividade: "Atividade",
  pipeline: "Pipeline",
  excecoes: "Exceções",
};

const warmblySurfaceLabels: Readonly<Record<string, string>> = {
  operacao: "Operação",
  cohorts: "Coortes",
  revisao: "Revisão",
};

function locationLabel(destination: DestinationId, surface: string | null | undefined): string {
  const root = getDestination(destination).label;
  const labels = destination === "comercial"
    ? commercialSurfaceLabels
    : destination === "warmbly"
      ? warmblySurfaceLabels
      : null;
  const child = labels && surface ? labels[surface] : undefined;
  return child ? `${root} / ${child}` : root;
}

function safeCurrentHref(destination: DestinationId, value: string | undefined): string {
  return value?.startsWith("#/") ? value : `#/${destination}`;
}

function conciseText(value: string, maxCharacters: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const characters = [...normalized];
  return characters.length <= maxCharacters
    ? normalized
    : `${characters.slice(0, maxCharacters - 1).join("")}…`;
}

const freshnessRank: Readonly<Record<FreshnessStatus, number>> = {
  FRESH: 0,
  STALE: 1,
  UNKNOWN: 2,
  ERROR: 3,
};

function worstFreshness(page: DestinationPage): FreshnessStatus | null {
  const statuses = collectProvenance(page).map((item) => item.freshness_status);
  if (statuses.length === 0) return null;
  return statuses.reduce((worst, status) =>
    freshnessRank[status] > freshnessRank[worst] ? status : worst,
  );
}

function mostUrgentAttention(page: DestinationPage): AttentionItem | null {
  const unresolved = page.attention.filter(
    (item) => item.status === "open" || item.status === "acknowledged",
  );
  const rank: Readonly<Record<AttentionItem["severity"], number>> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  return [...unresolved].sort((left, right) => {
    const severity = rank[left.severity] - rank[right.severity];
    if (severity !== 0) return severity;
    return left.detected_at.localeCompare(right.detected_at);
  })[0] ?? null;
}

function firstPriority(page: DestinationPage): PriorityRecommendation | null {
  return [...page.priorities].sort((left, right) => left.rank - right.rank)[0] ?? null;
}

function errorOrientation(
  destination: DestinationId,
  view: Extract<ViewState<DestinationPage>, { kind: "error" }>,
  location: string,
  currentHref: string,
): OrientationSummary {
  const denied = ["PERMISSION_DENIED", "FORBIDDEN", "UNAUTHORIZED", "HTTP_401", "HTTP_403"]
    .includes(view.code.toUpperCase());
  return {
    destination,
    locationLabel: location,
    viewKind: view.kind,
    state: denied
      ? {
          label: "Sem permissão para este recorte",
          detail: "A sessão atual não recebeu autoridade para ler esta área.",
          tone: "unknown",
        }
      : {
          label: "Leitura indisponível",
          detail: "O Control Center não conseguiu montar este recorte.",
          tone: "critical",
        },
    risk: {
      label: "Risco desconhecido",
      detail: "Sem uma leitura válida, nenhum estado operacional pode ser presumido.",
      tone: "unknown",
    },
    action: denied
      ? {
          label: "Reautenticar ou pedir acesso",
          detail: "Não tente contornar a autorização nem use outro recorte como prova.",
          kind: "recover",
          href: null,
        }
      : {
          label: "Recarregar este endereço",
          detail: "O recarregamento preserva a rota; confirme o estado antes de repetir uma ação.",
          kind: "recover",
          href: currentHref,
        },
    observedAt: null,
    observedAtLabel: "Atualização não disponível",
  };
}

function reliabilityOrientation(
  status: FreshnessStatus | null,
): { state: OrientationStatement; risk: OrientationStatement; action: OrientationAction } {
  switch (status) {
    case "FRESH":
      return {
        state: {
          label: "Leitura atual disponível",
          detail: "As fontes observadas neste recorte foram classificadas como atualizadas.",
          tone: "ok",
        },
        risk: {
          label: "Nenhum risco acionável observado",
          detail: "O recorte não retornou alerta ou prioridade que exija ação agora.",
          tone: "ok",
        },
        action: {
          label: "Nenhuma ação requerida agora",
          detail: "Acompanhe uma nova leitura; não crie trabalho ornamental.",
          kind: "none",
          href: null,
        },
      };
    case "STALE":
      return {
        state: {
          label: "Há dados desatualizados",
          detail: "Ao menos uma fonte ultrapassou a janela segura de atualização.",
          tone: "attention",
        },
        risk: {
          label: "Decisão pode usar estado antigo",
          detail: "Dado defasado não prova a situação atual e nunca equivale a saudável.",
          tone: "attention",
        },
        action: {
          label: "Conferir a origem antes de agir",
          detail: "Use a proveniência no conteúdo para obter uma leitura atual.",
          kind: "recover",
          href: "#orientacao-conteudo",
        },
      };
    case "UNKNOWN":
      return {
        state: {
          label: "Parte do estado é desconhecida",
          detail: "Ao menos uma fonte não informou uma leitura confiável.",
          tone: "unknown",
        },
        risk: {
          label: "Risco não pode ser descartado",
          detail: "Ausência de prova não é zero, sucesso ou estado saudável.",
          tone: "unknown",
        },
        action: {
          label: "Confirmar a fonte antes de decidir",
          detail: "Consulte a proveniência e não execute mutação com estado desconhecido.",
          kind: "recover",
          href: "#orientacao-conteudo",
        },
      };
    case "ERROR":
      return {
        state: {
          label: "Leitura parcial com erro",
          detail: "Ao menos uma coleta falhou; os demais dados continuam visíveis com cautela.",
          tone: "critical",
        },
        risk: {
          label: "O panorama pode estar incompleto",
          detail: "Não interprete uma falha de coleta como ausência de ocorrências.",
          tone: "critical",
        },
        action: {
          label: "Investigar a coleta antes de agir",
          detail: "Abra a proveniência e siga a recuperação indicada pela fonte.",
          kind: "recover",
          href: "#orientacao-conteudo",
        },
      };
    case null:
      return {
        state: {
          label: "Leitura disponível; atualidade não comprovada",
          detail: "Este recorte não trouxe proveniência suficiente para avaliar atualização.",
          tone: "unknown",
        },
        risk: {
          label: "Risco não comprovado",
          detail: "Sem proveniência, a ausência de alertas não autoriza concluir que está tudo bem.",
          tone: "unknown",
        },
        action: {
          label: "Confirmar a leitura antes de agir",
          detail: "Use somente evidência com origem e horário observáveis.",
          kind: "recover",
          href: "#orientacao-conteudo",
        },
      };
  }
}

export function buildOrientationSummary(input: OrientationInput): OrientationSummary {
  const { destination, view } = input;
  const location = locationLabel(destination, input.surface);
  const currentHref = safeCurrentHref(destination, input.currentHref);

  if (view.kind === "loading") {
    return {
      destination,
      locationLabel: location,
      viewKind: view.kind,
      state: {
        label: "Carregando esta área",
        detail: "A estrutura está disponível enquanto os dados são consultados.",
        tone: "neutral",
      },
      risk: {
        label: "Risco ainda não avaliado",
        detail: "A leitura ainda não terminou; nenhum resultado foi presumido.",
        tone: "unknown",
      },
      action: {
        label: "Aguardar a leitura",
        detail: "Não repita nem antecipe uma ação enquanto o estado está carregando.",
        kind: "wait",
        href: null,
      },
      observedAt: null,
      observedAtLabel: "Atualização em andamento",
    };
  }

  if (view.kind === "error") return errorOrientation(destination, view, location, currentHref);

  if (view.kind === "empty") {
    return {
      destination,
      locationLabel: location,
      viewKind: view.kind,
      state: {
        label: "Recorte vazio",
        detail: view.message,
        tone: "neutral",
      },
      risk: {
        label: "Nenhum item acionável foi retornado",
        detail: "Vazio descreve este recorte; não transforma dado ausente em zero ou saudável.",
        tone: "neutral",
      },
      action: {
        label: "Nenhuma ação requerida neste recorte",
        detail: "Mude o recorte somente se houver outra tarefa explícita.",
        kind: "none",
        href: null,
      },
      observedAt: null,
      observedAtLabel: "Horário da leitura não informado",
    };
  }

  const page = view.data;
  const observedAt = isUtcDateTime(page.generated_at) ? page.generated_at : null;
  const effectiveFreshness = view.kind === "stale" ? "STALE" : worstFreshness(page);
  const reliability = reliabilityOrientation(effectiveFreshness);
  const mayOfferDomainAction = effectiveFreshness === "FRESH";
  const attention = mostUrgentAttention(page);
  const priority = firstPriority(page);

  if (attention) {
    return {
      destination,
      locationLabel: location,
      viewKind: view.kind,
      state: reliability.state,
      risk: {
        label: `Risco ${severityLabel(attention.severity)}: ${conciseText(attention.title, 96)}`,
        detail:
          attention.status === "acknowledged"
            ? "O alerta foi reconhecido, mas ainda não está resolvido."
            : conciseText(attention.summary, 180),
        tone: attention.severity === "critical" ? "critical" : "attention",
      },
      action: mayOfferDomainAction
        ? {
            label: "Revisar esta exceção no conteúdo",
            detail: attention.recommended_action?.trim()
              ? `Recomendação observada: ${conciseText(attention.recommended_action, 140)} O link apenas abre o conteúdo; autorização e confirmação continuam valendo.`
              : "O link apenas abre o conteúdo; autorização e confirmação continuam valendo.",
            kind: "act",
            href: "#orientacao-conteudo",
          }
        : reliability.action,
      observedAt,
      observedAtLabel: observedAt
        ? `Leitura gerada em ${formatLocal(observedAt)}`
        : "Horário da leitura inválido ou não informado",
    };
  }

  if (priority) {
    return {
      destination,
      locationLabel: location,
      viewKind: view.kind,
      state: reliability.state,
      risk: {
        label: `Prioridade ${priority.rank}: ${conciseText(priority.title, 96)}`,
        detail: conciseText(priority.rationale, 180),
        tone: "attention",
      },
      action: mayOfferDomainAction
        ? {
            label: "Revisar esta prioridade no conteúdo",
            detail: priority.recommended_action?.trim()
              ? `Recomendação observada: ${conciseText(priority.recommended_action, 140)} O link não executa mutação.`
              : "O link apenas abre o conteúdo operacional e não executa mutação.",
            kind: "act",
            href: "#orientacao-conteudo",
          }
        : reliability.action,
      observedAt,
      observedAtLabel: observedAt
        ? `Leitura gerada em ${formatLocal(observedAt)}`
        : "Horário da leitura inválido ou não informado",
    };
  }

  return {
    destination,
    locationLabel: location,
    viewKind: view.kind,
    state: reliability.state,
    risk: reliability.risk,
    action: reliability.action,
    observedAt,
    observedAtLabel: observedAt
      ? `Leitura gerada em ${formatLocal(observedAt)}`
      : "Horário da leitura inválido ou não informado",
  };
}

function statement(
  field: Exclude<OrientationField, "next-action">,
  title: string,
  value: OrientationStatement,
): string {
  return `<div class="orientation-field" data-orientation-field="${field}" data-orientation-tone="${value.tone}">
    <h2>${title}</h2>
    <p class="orientation-value">${escapeHtml(value.label)}</p>
    <p class="orientation-detail">${escapeHtml(value.detail)}</p>
  </div>`;
}

export function renderOrientationSummary(summary: OrientationSummary): string {
  const actionBody = summary.action.href === null
    ? `<p class="orientation-value">${escapeHtml(summary.action.label)}</p>`
    : `<a class="orientation-primary-action" data-orientation-primary-action="true" href="${escapeHtml(summary.action.href)}">${escapeHtml(summary.action.label)}</a>`;
  const observedAt = summary.observedAt === null
    ? escapeHtml(summary.observedAtLabel)
    : `<time datetime="${escapeHtml(summary.observedAt)}">${escapeHtml(summary.observedAtLabel)}</time>`;

  return `<section class="orientation-summary" aria-labelledby="orientation-title" data-orientation-contract="v1" data-orientation-destination="${escapeHtml(summary.destination)}" data-orientation-view="${summary.viewKind}">
    <header class="orientation-heading">
      <h2 id="orientation-title">Orientação rápida — ${escapeHtml(summary.locationLabel)}</h2>
      <p>${observedAt}</p>
    </header>
    <div class="orientation-grid">
      ${statement("state", "Estado atual", summary.state)}
      ${statement("risk", "Risco ou prioridade", summary.risk)}
      <div class="orientation-field" data-orientation-field="next-action" data-orientation-action-kind="${summary.action.kind}">
        <h2>Próxima ação</h2>
        ${actionBody}
        <p class="orientation-detail">${escapeHtml(summary.action.detail)}</p>
      </div>
    </div>
  </section>`;
}
