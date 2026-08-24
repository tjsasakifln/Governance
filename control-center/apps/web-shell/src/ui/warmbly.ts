/**
 * "Operação Warmbly" — the safe-operation cockpit for the CONFENGE outbound
 * kill switch.
 *
 * Three controls and nothing else: pause, resume, acknowledge. There is no send
 * control here and there must never be one — this surface can stop outbound and
 * let it flow again, and that is the whole of its authority.
 *
 * Everything an operator needs to decide is rendered *before* the controls:
 * dispatch state, why it is in that state, the commercial window, the approved
 * queue, the hourly cap, and who last touched the switch. Every reading is
 * observed-or-"—", and `state` is tri-state because Warmbly reporting nothing
 * is not the same as Warmbly reporting "running": an operator told ACTIVE when
 * nobody knows will make the wrong call.
 */

import { escapeHtml } from "../escape";
import { formatLocal } from "../datetime";
import { ownMapValue } from "../own-map";
import {
  DEFAULT_WARMBLY_SURFACE,
  WARMBLY_SURFACES,
  isWarmblySurface,
  type WarmblySurface,
} from "../destinations";
import type { AdapterWriteResult } from "../adapters/contract";
import {
  adjustDraft,
  adjustRouteMissing,
  gateInFlight,
  type AdjustDraft,
} from "../human-gate-flight";
import { AUTH_HOST, PRODUCTIVE_HOST } from "../topology";
import type { ActorRef, CommercialSnapshot } from "../types";
import type { PendingResumeConfirmation } from "../warmbly-confirmation";
import {
  editorialReasonLabel,
  editorialReasonSentence,
  mergeEditorialState,
  readEditorialState,
  type EditorialReading,
} from "./editorial-state";
import {
  operatorActionLabel,
  operatorOutcomeLabel,
  routeClassLabel,
  technicalDetails,
} from "./labels";
import { provenanceBlock } from "./provenance";

/** Named once: the out-of-band way to stop outbound when this channel cannot. */
export const OUT_OF_BAND_PAUSE_FALLBACK = "deploy/confenge-vps/pause.sh";

export interface WarmblySurfaceInput {
  snapshot: CommercialSnapshot | undefined;
  operator: ActorRef;
  /** Result of the operator's last dispatch call in this session, if any. */
  operatorResult?: AdapterWriteResult;
  /** Challenge bound to the exact reason and observation shown on this render. */
  confirmation?: PendingResumeConfirmation;
  gate?: Record<string, unknown>;
  query?: string;
  /** Selected cohort id, carried by the route so the subnav cannot drop it. */
  resource?: string | null;
}

export type WarmblySurfaceRenderer = (input: WarmblySurfaceInput) => string;

const WARMBLY_SURFACE_LABELS: Record<WarmblySurface, string> = {
  operacao: "Operação segura",
  cohorts: "Cohorts",
  revisao: "Revisão",
};

/* ------------------------------------------------------------------ *
 * Outcome of the last action: executed, refused, failed or unresolved.
 * ------------------------------------------------------------------ */

export const DISPATCH_OUTCOME_KINDS = [
  "executed",
  "challenged",
  "refused",
  "failed",
  "unknown",
] as const;
export type DispatchOutcomeKind = (typeof DISPATCH_OUTCOME_KINDS)[number];

export interface DispatchOutcomeView {
  kind: DispatchOutcomeKind;
  /** Short pt-BR verdict. Never a bare HTTP status. */
  title: string;
  /** What the channel said, verbatim. */
  detail: string;
  /** What the operator does next. Always present: a verdict with no next move is not guidance. */
  recovery: string;
  code: string | null;
  status: number | null;
}

interface OutcomeRule {
  kind: DispatchOutcomeKind;
  title: string;
  recovery: string;
}

/**
 * Keyed by the channel's own refusal code, because the HTTP status cannot
 * separate the cases that matter most. `circuit_open`, `transport_error` and
 * `transport_unknown` are all 503, and they mean "not attempted", "never
 * written" and "may already be applied" — three different next moves.
 *
 * `upstream_error` is the one place this table deliberately departs from the
 * channel's own wording: the channel calls a Warmbly 5xx a refusal, but for the
 * operator it is a failure at Warmbly, not a refusal by the Control Center.
 */
const OUTCOME_BY_CODE: Record<string, OutcomeRule> = {
  client_precondition: {
    kind: "refused",
    title: "Recusada aqui mesmo: pedido incompleto",
    recovery:
      "Nada saiu do navegador e nada foi aplicado no Warmbly. Preencha o motivo — e o id do alerta, quando for reconhecimento — e envie de novo.",
  },
  missing_actor: {
    kind: "refused",
    title: "Recusada: sessão não identificada",
    recovery:
      "O Authelia não entregou a identidade do operador nesta requisição. Reautentique e repita. A recusa já está na trilha de auditoria.",
  },
  unknown_action: {
    kind: "refused",
    title: "Recusada: ação desconhecida",
    recovery:
      "Este canal expõe exatamente pausar, retomar e reconhecer. Se um controle desta tela pediu outra coisa, é defeito: registre e não repita.",
  },
  forbidden_path: {
    kind: "refused",
    title: "Recusada: caminho fora do allowlist de escrita",
    recovery:
      "O conector não classifica esse caminho como escrita permitida e não o seguiu. Nada foi aplicado. Isto é configuração do conector, não do operador.",
  },
  confirmation_not_applicable: {
    kind: "refused",
    title: "Recusada: esta ação não usa confirmação",
    recovery: "Pausar e reconhecer são de um passo. Envie sem token de confirmação.",
  },
  invalid_reason: {
    kind: "refused",
    title: "Recusada: motivo de auditoria inválido",
    recovery:
      "O motivo é o único registro de por que a chave foi mexida. Escreva uma frase e envie de novo. Nada foi aplicado.",
  },
  invalid_target: {
    kind: "refused",
    title: "Recusada: alvo inválido",
    recovery: "Informe o id do alerta a reconhecer e envie de novo. Nada foi aplicado.",
  },
  confirmation_required: {
    kind: "refused",
    title: "Confirmação exigida: a retomada não foi executada",
    recovery:
      "Retomar é de dois passos. Envie o primeiro passo, leia o resumo de impacto e confirme em seguida.",
  },
  confirmation_invalid: {
    kind: "refused",
    title: "Recusada: confirmação inválida ou vencida",
    recovery:
      "O token já foi gasto ou expirou, e ele é de uso único e ligado a quem o pediu. Refaça os dois passos. O outbound continua como estava.",
  },
  confirmation_stale: {
    kind: "refused",
    title: "Confirmação descartada: a leitura mudou",
    recovery:
      "A retomada não foi executada. Releia o estado, a fila e o teto exibidos acima e peça uma nova confirmação.",
  },
  circuit_open: {
    kind: "refused",
    title: "Recusada: circuito do conector aberto — a ação não foi tentada",
    recovery:
      `Com o circuito aberto o canal recusa as três ações, pausar inclusive. Para parar o outbound agora use o fallback fora de banda ${OUT_OF_BAND_PAUSE_FALLBACK} na VPS e registre o que foi feito.`,
  },
  transport_error: {
    kind: "refused",
    title: "Falhou no transporte: a requisição nunca foi escrita",
    recovery:
      "Falha comprovadamente anterior ao envio, então nada foi aplicado no Warmbly. Repetir é seguro.",
  },
  transport_unknown: {
    kind: "unknown",
    title: "Sem resposta: pode ter sido aplicada",
    recovery:
      `A requisição saiu e a resposta não voltou. Não repita às cegas: leia o estado do disparo acima antes de agir. Se o outbound precisa parar agora, use ${OUT_OF_BAND_PAUSE_FALLBACK}.`,
  },
  browser_transport: {
    kind: "unknown",
    title: "Sem resposta do Control Center: desfecho desconhecido",
    recovery:
      `O navegador não obteve resposta e não é possível saber se a ação chegou a ser aplicada. Recarregue, leia o estado do disparo e a trilha antes de repetir. Se o outbound precisa parar agora, use ${OUT_OF_BAND_PAUSE_FALLBACK}.`,
  },
  operator_channel_not_configured: {
    kind: "refused",
    title: "Recusada: canal de operador desligado nesta instalação",
    recovery:
      `Este Control Center não tem o canal do Warmbly ligado, então nenhuma das três ações funciona por aqui e nada foi aplicado. Use ${OUT_OF_BAND_PAUSE_FALLBACK} na VPS se o outbound precisa parar, e ligue o canal antes de operar por esta tela.`,
  },
  unsupported_media_type: {
    kind: "refused",
    title: "Recusada: a requisição não foi enviada como JSON",
    recovery:
      "O serviço exige content-type application/json justamente para que um formulário de outra origem não consiga disparar estas ações. Nada foi aplicado; isto é defeito desta tela, não do operador.",
  },
  upstream_error: {
    kind: "failed",
    title: "Falhou no Warmbly: a ação foi enviada e recusada lá",
    recovery:
      "O canal chegou ao Warmbly e o Warmbly respondeu com erro. Confira o estado do disparo acima; se o outbound precisa parar, use o fallback fora de banda.",
  },

  /* ---------------------------------------------------------------- *
   * Gate humano de cohorts. Mesmo dicionário, códigos próprios: um
   * "recusado" genérico não diz ao operador o que corrigir, e cada um
   * destes exige um movimento diferente.
   * ---------------------------------------------------------------- */
  gate_precondition: {
    kind: "refused",
    title: "Recusada aqui mesmo: faltam campos obrigatórios",
    recovery:
      "Nada saiu do navegador e nada foi gravado no Warmbly. Complete os campos indicados no formulário e envie de novo.",
  },
  approval_acknowledgement_required: {
    kind: "refused",
    title: "Recusada: APPROVE exige a ciência marcada",
    recovery:
      "Aprovar é assumir que você leu destinatário, mensagem exata, policy e evidência desta versão. Marque a ciência e aprove de novo. HOLD e REJECT não pedem essa marcação.",
  },
  cohort_version_confirmation_required: {
    kind: "refused",
    title: "Recusada: falta a confirmação digitada da versão",
    recovery:
      "GO/NO-GO exige digitar a versão imutável (por exemplo v1). Nada foi decidido.",
  },
  insufficient_human_gate_role: {
    kind: "refused",
    title: "Recusada: sua sessão não tem a autoridade necessária",
    recovery:
      "Revisar exige o grupo operators; registrar GO/NO-GO exige admins. Nada foi aplicado. Peça a inclusão no grupo no Authelia e reautentique antes de repetir.",
  },
  idempotency_key_required: {
    kind: "refused",
    title: "Recusada: escrita sem chave de idempotência",
    recovery:
      "Toda escrita do gate viaja com uma chave que impede duplicar a intenção. Nada foi aplicado; isto é defeito desta tela, não do operador.",
  },
  human_gate_route_not_allowed: {
    kind: "refused",
    title: "Recusada: rota fora do allowlist fixo do gate",
    recovery:
      "O proxy do gate só encaminha um conjunto fixo de rotas e esta não está nele. Nada foi aplicado; isto é configuração do canal, não do operador.",
  },
  human_gate_transport_unknown: {
    kind: "unknown",
    title: "Sem resposta: a escrita pode ter sido aplicada",
    recovery:
      "A requisição saiu e a resposta não voltou. Não repita às cegas: recarregue esta versão e compare receipt e correlation id. Se repetir, repita a MESMA intenção — a chave de idempotência é preservada.",
  },
  human_gate_read_unavailable: {
    kind: "refused",
    title: "Leitura do gate não concluída: nenhuma escrita foi tentada",
    recovery: "Recarregue a página. Nada foi gravado.",
  },
  /* Ajuste (nova versão de conteúdo). */
  frozen_hash_mismatch: {
    kind: "refused",
    title: "Recusada: o conteúdo congelado mudou desde a sua leitura",
    recovery:
      "Você editou sobre uma versão que já não é a atual, então o ajuste não foi aplicado. Recarregue esta revisão, releia a mensagem congelada e refaça a edição sobre o texto novo.",
  },
  confirmation_mismatch: {
    kind: "refused",
    title: "Recusada: a confirmação não corresponde à versão",
    recovery:
      "Digite exatamente a versão exibida nesta revisão (por exemplo v1) e confirme de novo. Nada foi alterado.",
  },
  version_superseded: {
    kind: "refused",
    title: "Recusada: esta versão já foi substituída por outra mais nova",
    recovery:
      "Alguém criou uma versão posterior enquanto você editava. Abra a versão mais recente na lista de Cohorts e refaça o ajuste lá. Nada foi alterado aqui.",
  },
  authority_active: {
    kind: "refused",
    title: "Recusada: há autoridade bounded ativa para esta cohort",
    recovery:
      "Uma cohort com GO ativo não pode ter conteúdo ajustado. Registre NO-GO para revogar a autoridade e só então ajuste. Nada foi alterado.",
  },
  immutable_field: {
    kind: "refused",
    title: "Recusada: o pedido tocou um campo imutável",
    recovery:
      "Só assunto e corpo podem ser ajustados; destinatário, evidência, origem, policy e classe de rota são congelados. Nada foi alterado; isto é defeito desta tela, não do operador.",
  },
  copy_qa_failed: {
    kind: "refused",
    title: "Recusada: o texto proposto reprovou no QA de copy",
    recovery:
      "O Warmbly aplica as mesmas regras de copy da composição original. Leia os motivos no detalhe técnico, corrija o assunto ou o corpo e proponha de novo. Nada foi alterado.",
  },
  candidate_not_found: {
    kind: "refused",
    title: "Recusada: candidato não encontrado nesta versão",
    recovery:
      "O candidato não existe mais nesta versão da cohort. Recarregue a revisão antes de agir de novo.",
  },
  adjust_route_unavailable: {
    kind: "refused",
    title: "Ajuste ainda não disponível nesta instalação",
    recovery:
      "A rota de ajuste do Warmbly ainda não foi implantada neste ambiente, então nada foi alterado. Enquanto isso, registre HOLD ou REJECT com o motivo e refaça a cohort quando a rota entrar no ar.",
  },
};

/** Fallback when the channel answers a status this build does not have a code for. */
const OUTCOME_BY_STATUS: Record<number, OutcomeRule> = {
  400: { kind: "refused", title: "Recusada: pedido inválido", recovery: "Corrija os campos e envie de novo. Nada foi aplicado." },
  401: {
    kind: "refused",
    title: "Recusada: sessão não identificada",
    recovery: "Reautentique no Authelia e repita.",
  },
  403: {
    kind: "refused",
    title: "Recusada: ação não permitida",
    recovery: "Nada foi aplicado. Não repita sem entender a recusa registrada na trilha.",
  },
  405: {
    kind: "refused",
    title: "Recusada: método não permitido",
    recovery: "As rotas de operador são POST; a trilha é somente leitura. Isto é defeito desta tela, não do operador.",
  },
  404: {
    kind: "refused",
    title: "Recusada: canal de operador não montado",
    recovery:
      `O Control Center desta instalação não tem o canal ligado, então nenhuma das três ações funciona aqui. Use ${OUT_OF_BAND_PAUSE_FALLBACK} para parar o outbound e habilite o canal antes de operar por esta tela.`,
  },
  415: {
    kind: "refused",
    title: "Recusada: formato de requisição não aceito",
    recovery: "Nada foi aplicado. Isto é defeito desta tela, não do operador.",
  },
  428: {
    kind: "refused",
    title: "Recusada: confirmação exigida",
    recovery: "Refaça os dois passos da retomada.",
  },
  502: {
    kind: "failed",
    title: "Falhou no Warmbly",
    recovery: "O Warmbly respondeu com erro. Confira o estado do disparo antes de repetir.",
  },
  503: {
    kind: "refused",
    title: "Recusada: canal indisponível",
    recovery: `Confira o estado do disparo. Para parar o outbound agora use ${OUT_OF_BAND_PAUSE_FALLBACK}.`,
  },
};

const OUTCOME_BY_CHANNEL_OUTCOME: Record<string, OutcomeRule> = {
  executed: {
    kind: "executed",
    title: "Executada no Warmbly",
    recovery: "Confirme o efeito no estado do disparo acima; a trilha registra quem agiu e quando.",
  },
  challenged: {
    kind: "challenged",
    title: "Confirmação pendente: a retomada ainda não foi executada",
    recovery:
      "Leia o resumo de impacto e envie a confirmação. O token é de uso único, vence sozinho e vale só para quem o pediu.",
  },
  refused: {
    kind: "refused",
    title: "Recusada",
    recovery: "Nada foi aplicado no Warmbly. Leia o motivo abaixo antes de repetir.",
  },
  unknown: {
    kind: "unknown",
    title: "Desfecho desconhecido",
    recovery: `Pode ter sido aplicada. Leia o estado do disparo antes de repetir; para parar agora use ${OUT_OF_BAND_PAUSE_FALLBACK}.`,
  },
};

const OUTCOME_LABELS: Record<DispatchOutcomeKind, string> = {
  executed: "EXECUTADA",
  challenged: "CONFIRMAÇÃO PENDENTE",
  refused: "RECUSADA",
  failed: "FALHOU",
  unknown: "DESCONHECIDO",
};

const OUTCOME_TONE: Record<DispatchOutcomeKind, string> = {
  executed: "ok",
  challenged: "stale",
  refused: "error",
  failed: "error",
  unknown: "stale",
};

/**
 * Turns a raw dispatch result into an explicit verdict plus a next move.
 *
 * Resolution order is code, then the channel's own outcome word, then the HTTP
 * status, then `ok`. Code first because the status is ambiguous exactly where
 * the stakes are highest; `ok` last because a 200 that carried no recognizable
 * body still has to say something honest.
 */
export function classifyDispatchOutcome(result: AdapterWriteResult): DispatchOutcomeView {
  const code = typeof result.code === "string" && result.code !== "" ? result.code : null;
  const status = typeof result.status === "number" ? result.status : null;
  const rule =
    (code ? ownMapValue(OUTCOME_BY_CODE, code) : undefined) ??
    (result.outcome ? ownMapValue(OUTCOME_BY_CHANNEL_OUTCOME, result.outcome) : undefined) ??
    (status !== null
      ? ownMapValue(OUTCOME_BY_STATUS as unknown as Record<string, OutcomeRule>, String(status))
      : undefined) ??
    (result.ok
      ? OUTCOME_BY_CHANNEL_OUTCOME.executed!
      : {
          kind: "unknown" as const,
          title: "Desfecho não classificado",
          recovery:
            `O canal respondeu algo que esta tela não sabe classificar. Trate como possivelmente aplicada: leia o estado do disparo e a trilha antes de repetir. Para parar o outbound agora use ${OUT_OF_BAND_PAUSE_FALLBACK}.`,
        });
  return {
    kind: rule.kind,
    title: rule.title,
    detail: result.message,
    recovery: rule.recovery,
    code,
    status,
  };
}

const GATE_ACTION_LABELS: Record<string, string> = {
  create: "criar cohort congelada",
  reproduce: "reproduzir versão imutável",
  validate: "verificar destinatário",
  review: "registrar decisão de revisão",
  decide: "registrar GO/NO-GO",
  adjust: "ajustar assunto e corpo",
};

const READBACK_LABELS: Record<string, string> = {
  confirmed: "Releitura do servidor confirmou o novo estado.",
  not_confirmed:
    "A releitura do servidor ainda NÃO mostra este efeito. O canal aceitou a chamada, mas o recurso lido não confirma a mudança: recarregue antes de concluir que foi aplicada.",
  unavailable:
    "Não foi possível reler o recurso para confirmar. Aceite do canal não é prova de efeito: recarregue e confira antes de repetir.",
  skipped: "Releitura não aplicável a esta resposta.",
};

/**
 * The one banner every write outcome goes through.
 *
 * Operation, Cohorts and Revisão share it deliberately. Three copies of this
 * block would drift, and the surfaces that never had one — Cohorts and Revisão —
 * are exactly where an operator was left with no success, no refusal, no code
 * and no next move after every create, review and GO.
 */
export function writeResultBlock(result: AdapterWriteResult | undefined): string {
  if (!result) return "";
  const view = classifyDispatchOutcome(result);
  const tone = ownMapValue(OUTCOME_TONE, view.kind) ?? "stale";
  const role = view.kind === "executed" || view.kind === "challenged" ? "status" : "alert";
  const summary: Record<DispatchOutcomeKind, string> = {
    executed: "A ação foi aceita pelo canal de operação.",
    challenged: "A ação ainda não foi executada; falta a confirmação final.",
    refused: "A ação foi recusada e não deve ser repetida sem corrigir a causa.",
    failed: "A tentativa falhou; confirme o estado observado antes de tentar novamente.",
    unknown: "Não foi possível comprovar se a ação chegou a ser aplicada.",
  };
  const actionLabel = result.gateAction
    ? ownMapValue(GATE_ACTION_LABELS, result.gateAction) ?? "ação do gate não catalogada"
    : "";
  const readback = result.readback;
  const diffRows = (result.diff ?? [])
    .map(
      (entry) =>
        `<div data-diff-field="${escapeHtml(entry.field)}"><dt>${escapeHtml(entry.field)}</dt><dd><del>${escapeHtml(
          entry.before ?? "—",
        )}</del> <ins>${escapeHtml(entry.after ?? "—")}</ins></dd></div>`,
    )
    .join("");
  return `
    <article
      class="card banner ${tone}"
      role="${role}"
      data-dispatch-outcome="${escapeHtml(view.kind)}"
      data-write-result="${escapeHtml(view.kind)}"
      data-outcome-code="${escapeHtml(view.code ?? "")}"
      data-outcome-status="${view.status ?? ""}"
      data-gate-action="${escapeHtml(result.gateAction ?? "")}"
    >
      <p class="kicker"><span class="pill">${escapeHtml(ownMapValue(OUTCOME_LABELS, view.kind) ?? "DESFECHO NÃO RECONHECIDO")}</span>${
        actionLabel ? ` <span class="scope">${escapeHtml(actionLabel)}</span>` : ""
      }</p>
      <h3>${escapeHtml(view.title)}</h3>
      <p data-outcome-detail="true">${escapeHtml(ownMapValue(summary, view.kind) ?? "O canal retornou um desfecho não reconhecido.")}</p>
      <p class="constraint" data-outcome-recovery="true">O que fazer agora: ${escapeHtml(view.recovery)}</p>
      ${
        readback
          ? `<p class="constraint" data-readback="${escapeHtml(readback.status)}">Releitura: ${escapeHtml(
              ownMapValue(READBACK_LABELS, readback.status) ?? "estado de releitura não reconhecido",
            )}${readback.detail ? ` ${escapeHtml(readback.detail)}` : ""}</p>`
          : ""
      }
      <dl class="facts" data-write-evidence="true">
        ${fact("Código do canal", view.code ?? "nenhum código devolvido")}
        ${fact("Receipt", result.receiptId ?? result.receipt?.id ?? "não devolvido nesta resposta")}
        ${fact(
          "Correlation id",
          result.correlationId ?? result.receipt?.correlation_id ?? "não devolvido nesta resposta",
        )}
      </dl>
      ${
        diffRows
          ? `<dl class="facts" data-server-diff="true">${diffRows}</dl>`
          : ""
      }
      ${technicalDetails(
        [
          { term: "path", value: result.path },
          { term: "message", value: view.detail },
          { term: "code", value: view.code ?? "" },
          { term: "status", value: view.status === null ? "" : String(view.status) },
          { term: "outcome", value: result.outcome ?? "" },
          { term: "gate_action", value: result.gateAction ?? "" },
          { term: "receipt", value: result.receiptId ?? result.receipt?.id ?? "" },
          { term: "correlation_id", value: result.correlationId ?? result.receipt?.correlation_id ?? "" },
          { term: "readback", value: readback?.status ?? "" },
        ],
        "warmbly-operator-result",
      )}
    </article>`;
}

/** The "enviando…" state. A control with no pending state invites a second click. */
function pendingBlock(label: string): string {
  return `
    <article class="card banner stale" role="status" data-write-pending="true">
      <p class="kicker"><span class="pill">ENVIANDO</span></p>
      <h3>${escapeHtml(label)}</h3>
      <p>A chamada saiu e a resposta ainda não voltou. Não repita: este formulário está bloqueado até o canal responder.</p>
    </article>`;
}

/**
 * Routes one write outcome to exactly one place on the page.
 *
 * "On the affected card" is the requirement, and "rendered once" is the other
 * half of it: a banner repeated at the top and on the card reads as two events.
 * The first claimant wins; whatever is left over lands at the top of the
 * surface so a result can never be swallowed.
 */
export interface FeedbackRouter {
  forCandidate(candidateId: string): string;
  forCohort(cohortId: string): string;
  remainder(): string;
}

export function feedbackRouter(result: AdapterWriteResult | undefined): FeedbackRouter {
  let claimed = false;
  const claim = (): string => {
    claimed = true;
    return writeResultBlock(result);
  };
  return {
    forCandidate(candidateId: string): string {
      if (claimed || !result || !candidateId) return "";
      return result.gateTarget?.candidate_id === candidateId ? claim() : "";
    },
    forCohort(cohortId: string): string {
      if (claimed || !result || !cohortId) return "";
      if (result.gateTarget?.candidate_id) return "";
      return result.gateTarget?.cohort_id === cohortId ? claim() : "";
    },
    remainder(): string {
      if (claimed || !result) return "";
      return claim();
    },
  };
}

/* ------------------------------------------------------------------ *
 * Readings, rendered before the controls.
 * ------------------------------------------------------------------ */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Observed-or-"—". An absent reading is never rendered as a zero or a default. */
function show(value: unknown): string {
  return value === undefined || value === null || value === "" ? "—" : String(value);
}

function fact(label: string, value: string, extra = ""): string {
  return `<div${extra}><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function stamp(value: unknown): string {
  return typeof value === "string" && value !== "" ? formatLocal(value) : "—";
}

interface DispatchReading {
  state: string;
  stateLabel: string;
  observed: boolean;
  pauseReason: string;
  window: string;
  inWindow: string;
  nextSlot: string;
  volume: string;
  queued: string;
  why: string;
}

export function readDispatch(operations: Record<string, unknown>): DispatchReading {
  const d = record(operations.dispatch);
  const state = typeof d.state === "string" && d.state !== "" ? d.state : "UNKNOWN";
  return {
    state,
    stateLabel: state === "PAUSED" ? "pausado" : state === "ACTIVE" ? "ativo" : "desconhecido",
    observed: d.observed === true,
    pauseReason: show(d.pause_reason),
    window:
      d.window_start && d.window_end
        ? `${String(d.window_start)}–${String(d.window_end)} ${show(d.timezone)}`
        : "—",
    inWindow:
      typeof d.in_send_window === "boolean"
        ? d.in_send_window
          ? "dentro da janela"
          : "fora da janela"
        : "—",
    nextSlot: show(d.next_slot_at),
    volume:
      typeof d.sent_last_hour === "number" || typeof d.cap === "number"
        ? `${show(d.sent_last_hour)} / ${show(d.cap)}`
        : "—",
    queued: show(d.queued_approved),
    why: typeof d.why === "string" ? d.why : "",
  };
}

/**
 * Freshness travels with the state. "PAUSADO" observed an hour ago and
 * "PAUSADO" observed just now support different decisions, and the operator
 * cannot tell them apart from the word alone.
 */
function stateBlock(reading: DispatchReading, provenance: CommercialSnapshot["provenance"] | undefined): string {
  return `
    <article class="card" data-dispatch-observed="${reading.observed ? "true" : "false"}">
      <p class="kicker"><span class="pill">${escapeHtml(reading.stateLabel)}</span></p>
      <h3>Estado do disparo de saída</h3>
      <dl class="facts">
        ${fact("Estado do disparo", reading.stateLabel)}
        ${fact("Motivo da pausa", reading.pauseReason)}
        ${fact("Janela comercial", reading.window)}
        ${fact("Agora", reading.inWindow)}
        ${fact("Próximo slot", reading.nextSlot)}
        ${fact("Aprovados na fila", reading.queued)}
        ${fact("Enviados na hora / teto", reading.volume)}
      </dl>
      ${
        reading.observed
          ? ""
          : `<p class="constraint" data-dispatch-unobserved="true">Nenhuma leitura de disparo foi observada nesta coleta. Estado desconhecido não significa ativo nem pausado: não conclua que o disparo está parado.</p>`
      }
      ${reading.why ? `<p class="constraint">${escapeHtml(reading.why)}</p>` : ""}
      ${provenance ? provenanceBlock(provenance) : ""}
    </article>`;
}

/* ------------------------------------------------------------------ *
 * Audit trail and operator identity.
 * ------------------------------------------------------------------ */

function ledgerRow(entry: Record<string, unknown>): string {
  const refusal = show(entry.refusal_code);
  const action = show(entry.action);
  const outcome = show(entry.outcome);
  const refusalLabel = refusal === "—"
    ? "sem recusa registrada"
    : ownMapValue(OUTCOME_BY_CODE, refusal)?.title ?? "código de recusa não reconhecido";
  return `
    <article class="card" data-ledger-entry="${escapeHtml(show(entry.outcome))}">
      <p class="kicker"><span class="pill">${escapeHtml(operatorOutcomeLabel(outcome))}</span> <span class="scope">${escapeHtml(operatorActionLabel(action))}</span></p>
      <h3>${escapeHtml(stamp(entry.recorded_at))}</h3>
      <dl class="facts">
        ${fact("Operador registrado", show(entry.actor_id))}
        ${fact("Alvo", show(entry.target))}
        ${fact("Motivo registrado", show(entry.reason))}
        ${fact("Recusa", refusalLabel)}
      </dl>
      ${technicalDetails(
        [
          { term: "action", value: action },
          { term: "outcome", value: outcome },
          { term: "refusal_code", value: refusal === "—" ? "" : refusal },
          { term: "upstream_status", value: show(entry.upstream_status) },
          { term: "correlation_id", value: show(entry.correlation_id) },
        ],
        "warmbly-ledger-entry",
      )}
    </article>`;
}

function auditBlock(operations: Record<string, unknown>, operator: ActorRef): string {
  const status = typeof operations.operator_ledger_status === "string" ? operations.operator_ledger_status : "absent";
  const entries = Array.isArray(operations.operator_ledger)
    ? operations.operator_ledger.filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    : [];
  const detail = typeof operations.operator_ledger_detail === "string" ? operations.operator_ledger_detail : "";
  let body: string;
  if (status === "read" && entries.length > 0) {
    body = `<div class="stack">${entries.map(ledgerRow).join("")}</div>`;
  } else if (status === "read") {
    // Read successfully and genuinely empty — but the ledger is in-process, so
    // a restart empties it. Empty is not proof that nobody acted.
    body = `<p class="banner empty">Trilha lida e vazia nesta instância do Control Center. Um reinício do serviço esvazia este registro — ausência aqui não prova que ninguém agiu.</p>`;
  } else if (status === "not_mounted") {
    body = `<p class="banner error" role="alert">O canal de operador não está montado neste Control Center (${escapeHtml(detail || "HTTP 404")}), então não há trilha para ler e nenhuma das três ações funcionará por esta tela.</p>`;
  } else if (status === "unreadable") {
    body = `<p class="banner error" role="alert">Não foi possível ler a trilha (${escapeHtml(detail || "erro")}). Ilegível não é vazia: não conclua que ninguém agiu.</p>`;
  } else {
    body = `<p class="banner empty">Trilha não consultada neste carregamento.</p>`;
  }
  return `
    <section class="stack" aria-labelledby="warmbly-auditoria" data-ledger-status="${escapeHtml(status)}">
      <h2 id="warmbly-auditoria">Trilha recente de auditoria</h2>
      <p class="constraint">Toda chamada entra na trilha de auditoria, executada ou recusada.</p>
      ${technicalDetails(
        [
          { term: "schema", value: "control-center.warmbly-operator-action.v1" },
          { term: "espelho", value: "domains/agent-activity" },
        ],
        "warmbly-ledger-contract",
      )}
      <article class="card" data-operator-identity="true">
        <h3>Identidade do operador</h3>
        <dl class="facts">
          ${fact("Sessão nesta tela", operator.display_name ?? operator.id)}
          ${fact("Identificador auditável", operator.id)}
        </dl>
        <p class="constraint">Quem a trilha registra é a identidade do Authelia resolvida na borda, não este identificador de leitura: as três ações não enviam cabeçalho de ator. Se os dois divergirem, o campo &quot;Operador registrado&quot; de cada entrada é o que vale.</p>
      </article>
      ${body}
    </section>`;
}

/* ------------------------------------------------------------------ *
 * Controls.
 * ------------------------------------------------------------------ */

function impactSummary(reading: DispatchReading): string {
  const quantified = reading.queued !== "—" || reading.volume !== "—";
  return `
    <dl class="facts" data-resume-impact="true">
      ${fact("Aprovados na fila que podem sair", reading.queued)}
      ${fact("Enviados na hora / teto", reading.volume)}
      ${fact("Janela comercial", reading.window)}
      ${fact("Agora", reading.inWindow)}
      ${fact("Próximo slot", reading.nextSlot)}
    </dl>
    ${
      quantified
        ? ""
        : `<p class="constraint" data-impact-unquantified="true">A coleta não trouxe fila nem teto, então o volume que a retomada libera não pode ser quantificado aqui. Confirme no Warmbly antes de retomar.</p>`
    }`;
}

function controlsBlock(
  reading: DispatchReading,
  confirmation: PendingResumeConfirmation | undefined,
): string {
  const confirmationArmed = confirmation !== undefined;
  return `
    <section class="stack" aria-labelledby="warmbly-controles" data-resume-armed="${confirmationArmed ? "true" : "false"}">
      <h2 id="warmbly-controles">Controles</h2>
      <p class="constraint" data-operator-scope="warmbly-write">Estas três ações escrevem no Warmbly. Não existe controle de envio aqui: pausar, retomar e reconhecer é toda a autoridade desta superfície. A identidade vem do Authelia na borda; nenhum cabeçalho de ator sai desta tela.</p>
      <p class="constraint" data-circuit-caveat="true">Com o circuito do conector aberto o canal recusa as três ações, pausar inclusive. Nesse caso o único jeito de parar o outbound é o fallback fora de banda <code>${escapeHtml(OUT_OF_BAND_PAUSE_FALLBACK)}</code> na VPS.</p>
      <article class="card">
        <h3>Pausar o outbound</h3>
        <p>Um passo. Interrompe o disparo; nada é enviado enquanto durar a pausa.</p>
        <form data-warmbly-dispatch="pause" class="operator-form">
          <label>Motivo <input name="reason" required minlength="2" maxlength="200" placeholder="por que está pausando" /></label>
          <button type="submit">Pausar disparos</button>
        </form>
      </article>
      <article class="card" data-two-step="true">
        <h3>Retomar o outbound</h3>
        <p>Dois passos. Retomar libera e-mail frio para empresas reais — este é o impacto de confirmar:</p>
        ${impactSummary(reading)}
        ${
          confirmationArmed
            ? `<p class="banner stale" role="status" data-confirmation-pending="true">Confirmação pendente e ainda não executada. O próximo envio deste formulário executa a retomada. O token é de uso único, vence sozinho e vale só para quem o pediu; recarregar a página o descarta.</p>`
            : `<p class="constraint">Enviar uma vez pede a confirmação; enviar de novo, com o mesmo motivo, executa.</p>`
        }
        <form data-warmbly-dispatch="resume" class="operator-form" data-two-step="true">
          <label>Motivo <input name="reason" required minlength="2" maxlength="200" placeholder="por que está retomando"${confirmation ? ` value="${escapeHtml(confirmation.reason)}" readonly` : ""} /></label>
          <button type="submit">${confirmationArmed ? "Confirmar retomada (passo 2 de 2)" : "Retomar disparos (passo 1 de 2)"}</button>
        </form>
      </article>
      <article class="card">
        <h3>Reconhecer alerta de inbound</h3>
        <p>Um passo. Escreve o reconhecimento no Warmbly; não resolve a exceção no Control Center.</p>
        <form data-warmbly-dispatch="acknowledge" class="operator-form">
          <label>Alerta <input name="target_id" required minlength="1" maxlength="128" placeholder="id do lead" /></label>
          <label>Motivo <input name="reason" maxlength="200" placeholder="opcional" /></label>
          <button type="submit">Reconhecer alerta</button>
        </form>
      </article>
    </section>`;
}


/* ------------------------------------------------------------------ *
 * Gate humano: leitura do payload.
 *
 * Nada aqui recalcula elegibilidade, denominador ou validade. Quando um número
 * não veio no payload, a tela diz que não veio — derivar seria inventar uma
 * verdade que o servidor não afirmou.
 * ------------------------------------------------------------------ */

function array(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

/** Marker for a field the server did not send. Never a zero, never a guess. */
const NOT_IN_PAYLOAD = "não informado pelo servidor";

function fromPayload(value: unknown): string {
  return value === undefined || value === null || value === "" ? NOT_IN_PAYLOAD : String(value);
}

interface GateSection {
  status: string;
  data: Record<string, unknown>;
  detail: string;
}

function gateSection(input: WarmblySurfaceInput, key: "list" | "selected"): GateSection {
  const gate = record(input.gate);
  const raw = record(gate[key]);
  const status = typeof gate[`${key}_status`] === "string" ? String(gate[`${key}_status`]) : "";
  const detail = typeof gate[`${key}_detail`] === "string" ? String(gate[`${key}_detail`]) : "";
  return {
    // An older payload carried no status at all. A section that has data is a
    // section that was read; anything else stays honestly unknown.
    status: status || (Object.keys(raw).length > 0 ? "read" : "absent"),
    data: raw,
    detail,
  };
}

function cohortRows(input: WarmblySurfaceInput): Record<string, unknown>[] {
  return array(gateSection(input, "list").data.data);
}

function selectedCohort(input: WarmblySurfaceInput): Record<string, unknown> {
  return record(gateSection(input, "selected").data.data);
}

/** The most recent version the server listed. Order is the server's, not ours. */
function latestCohort(input: WarmblySurfaceInput): Record<string, unknown> | undefined {
  const rows = cohortRows(input);
  return rows[0];
}

function gateUnreadableBanner(section: GateSection, what: string): string {
  if (section.status === "read" || section.status === "") return "";
  const message =
    section.status === "not_mounted"
      ? `O canal do gate não está montado neste Control Center (${section.detail || "HTTP 404"}), então ${what} não pôde ser lido. Ausência aqui não é ausência de cohorts.`
      : section.status === "forbidden"
        ? `Sua sessão não tem autorização para ler ${what} (${section.detail || "HTTP 403"}). Isto não significa que não existam cohorts.`
        : section.status === "absent"
          ? `Não houve leitura de ${what} neste carregamento.`
          : `Não foi possível ler ${what} (${section.detail || "erro"}). Ilegível não é vazio.`;
  // "Not consulted" is a different claim from "could not be read", and only the
  // second one is an alert. Both still have to be said out loud: a surface that
  // renders nothing where cohorts would go reads as "there are no cohorts".
  const tone = section.status === "absent" ? "empty" : "error";
  const role = section.status === "absent" ? "status" : "alert";
  return `<p class="banner ${tone}" role="${role}" data-gate-read="${escapeHtml(section.status)}">${escapeHtml(message)}</p>`;
}

/* ------------------------------------------------------------------ *
 * RBAC e ambiente.
 * ------------------------------------------------------------------ */

const CAPABILITY_LABELS: Record<string, string> = {
  operators: "revisar candidatos, criar e reproduzir cohorts, pedir verificação",
  admins: "registrar GO/NO-GO (autoridade bounded)",
};

export interface OperatorAuthority {
  /** Whether the channel actually told us the effective groups. */
  known: boolean;
  groups: readonly string[];
  canReview: boolean;
  canDecide: boolean;
}

/**
 * Effective authority, as reported by the edge — never as claimed by the browser.
 *
 * Authelia resolves the identity at the edge and the gate proxy echoes the
 * groups it enforced with. This surface reads that echo; it does not send an
 * actor, and it must not pretend to know an authority the channel never stated.
 */
export function operatorAuthority(input: WarmblySurfaceInput): OperatorAuthority {
  const gate = record(input.gate);
  const actor =
    record(record(gate.list).edge_actor).groups !== undefined
      ? record(record(gate.list).edge_actor)
      : record(record(gate.selected).edge_actor);
  const groups = Array.isArray(actor.groups)
    ? actor.groups.filter((group): group is string => typeof group === "string")
    : [];
  const known = Array.isArray(actor.groups);
  return {
    known,
    groups,
    canReview: groups.includes("operators"),
    canDecide: groups.includes("admins"),
  };
}

/**
 * Friendly identity plus effective capabilities (issue #59).
 *
 * The raw auditable identifier stays in the collapsed technical block: it is
 * needed to match an audit row, and it is not what an operator should have to
 * read to know who they are and what they may do.
 */
function identityBlock(input: WarmblySurfaceInput): string {
  const authority = operatorAuthority(input);
  const name = input.operator.display_name ?? "Sessão autenticada no Authelia";
  const capabilities = authority.known
    ? authority.groups.length > 0
      ? authority.groups
          .map((group) => `${group}: ${ownMapValue(CAPABILITY_LABELS, group) ?? "capacidade não catalogada nesta tela"}`)
          .join(" · ")
      : "nenhum grupo efetivo — esta sessão não pode escrever no gate"
    : NOT_IN_PAYLOAD;
  return `
    <article class="card" data-operator-identity="true" data-can-review="${authority.canReview ? "true" : "false"}" data-can-decide="${authority.canDecide ? "true" : "false"}">
      <p class="kicker"><span class="pill">${escapeHtml(authority.canDecide ? "admins" : authority.canReview ? "operators" : "sem autoridade de escrita")}</span></p>
      <h3>Quem você é nesta tela</h3>
      <dl class="facts">
        ${fact("Operador", name)}
        ${fact("Ambiente", PRODUCTIVE_HOST)}
        ${fact("Autenticação", `Authelia em ${AUTH_HOST}`)}
        ${fact("Capacidades efetivas", capabilities)}
      </dl>
      <p class="constraint">A identidade que a auditoria grava é a do Authelia resolvida na borda. Esta tela não envia cabeçalho de ator em nenhuma escrita.${
        authority.known ? "" : " O canal não devolveu os grupos efetivos neste carregamento, então as capacidades acima não puderam ser confirmadas."
      }</p>
      ${technicalDetails(
        [
          { term: "identificador_auditavel", value: input.operator.id },
          { term: "grupos_efetivos", value: authority.groups.join(",") },
        ],
        "warmbly-operator-identity",
      )}
    </article>`;
}

/* ------------------------------------------------------------------ *
 * Passo a passo do piloto.
 * ------------------------------------------------------------------ */

interface StepView {
  id: string;
  label: string;
  state: "done" | "current" | "pending" | "unknown";
  detail: string;
}

const STEP_STATE_LABELS: Record<string, string> = {
  done: "concluído",
  current: "é aqui que você está",
  pending: "ainda não",
  unknown: "não dá para saber com o que o servidor devolveu",
};

/**
 * Where the pilot stands, read strictly off the payload.
 *
 * Every "done" below is something the server said, not something this screen
 * counted. When the payload is silent the step is `unknown`, never `pending`:
 * "não sei" and "ainda não" are different answers and only one of them is safe.
 */
export function pilotSteps(input: WarmblySurfaceInput): StepView[] {
  const list = gateSection(input, "list");
  const rows = cohortRows(input);
  const cohort = Object.keys(selectedCohort(input)).length > 0 ? selectedCohort(input) : latestCohort(input);
  const readable = list.status === "read";
  const candidates = array(cohort?.candidates);
  const validations = candidates.map((candidate) => show(record(candidate.validation).status));
  const reviews = candidates.map((candidate) => show(record(candidate.review).decision));
  const decision = show(record(cohort?.decision).decision);
  const unknownStep = (id: string, label: string, detail: string): StepView => ({
    id,
    label,
    state: "unknown",
    detail,
  });
  if (!readable && rows.length === 0) {
    return [
      unknownStep("fonte", "Fonte", "O gate não pôde ser lido neste carregamento."),
      unknownStep("cohort", "Cohort", "O gate não pôde ser lido neste carregamento."),
      unknownStep("validacao", "Validação", "O gate não pôde ser lido neste carregamento."),
      unknownStep("revisao", "Revisão", "O gate não pôde ser lido neste carregamento."),
      unknownStep("go", "GO", "O gate não pôde ser lido neste carregamento."),
      unknownStep("handoff", "Handoff", "O gate não pôde ser lido neste carregamento."),
    ];
  }
  const hasCohort = cohort !== undefined && Object.keys(cohort).length > 0;
  const source = hasCohort ? show(cohort.source) : "—";
  const freshness = hasCohort ? show(cohort.freshness) : "—";
  const decided = decision === "GO" || decision === "NO_GO";
  const validationPending = validations.filter((status) => status !== "VALID").length;
  const reviewPending = reviews.filter((decisionValue) => decisionValue !== "APPROVE").length;
  return [
    {
      id: "fonte",
      label: "Fonte",
      state: hasCohort ? "done" : "pending",
      detail: hasCohort
        ? `Origem ${source}, freshness ${freshness}, as_of ${show(cohort.as_of)}.`
        : "Nenhuma cohort listada pelo servidor.",
    },
    {
      id: "cohort",
      label: "Cohort",
      state: hasCohort ? "done" : "current",
      detail: hasCohort
        ? `v${show(cohort.version)} congelada com ${candidates.length === 0 ? fromPayload(undefined) : String(candidates.length)} candidato(s) no payload.`
        : "Crie uma cohort pequena (1–10) em Cohorts para começar.",
    },
    {
      id: "validacao",
      label: "Validação",
      state: !hasCohort
        ? "pending"
        : candidates.length === 0
          ? "unknown"
          : validationPending === 0
            ? "done"
            : "current",
      detail:
        !hasCohort || candidates.length === 0
          ? "O payload desta versão não trouxe candidatos."
          : `${validations.filter((status) => status === "VALID").length} de ${candidates.length} com validação VALID segundo o servidor.`,
    },
    {
      id: "revisao",
      label: "Revisão",
      state: !hasCohort
        ? "pending"
        : candidates.length === 0
          ? "unknown"
          : reviewPending === 0
            ? "done"
            : "current",
      detail:
        !hasCohort || candidates.length === 0
          ? "O payload desta versão não trouxe candidatos."
          : `${reviews.filter((value) => value === "APPROVE").length} de ${candidates.length} aprovados segundo o servidor.`,
    },
    {
      id: "go",
      label: "GO",
      state: decided ? "done" : hasCohort ? "pending" : "pending",
      detail: decided
        ? `Decisão final registrada: ${decision}.`
        : hasCohort
          ? "Nenhuma decisão final registrada nesta versão."
          : "Sem cohort não existe GO.",
    },
    {
      id: "handoff",
      label: "Handoff",
      state: decision === "GO" ? "current" : "pending",
      detail:
        decision === "GO"
          ? "GO cria a autoridade bounded. Ele não enfileira, não envia e não liga auto-send."
          : "O handoff só existe depois de um GO registrado.",
    },
  ];
}

function stepperBlock(input: WarmblySurfaceInput): string {
  const steps = pilotSteps(input);
  const items = steps
    .map(
      (step) => `
      <li class="card" data-step="${escapeHtml(step.id)}" data-step-state="${escapeHtml(step.state)}">
        <p class="kicker"><span class="pill">${escapeHtml(ownMapValue(STEP_STATE_LABELS, step.state) ?? "estado não reconhecido")}</span></p>
        <h3>${escapeHtml(step.label)}</h3>
        <p>${escapeHtml(step.detail)}</p>
      </li>`,
    )
    .join("");
  return `<ol class="stack" data-pilot-stepper="true">${items}</ol>`;
}

/**
 * The landing card of `#/warmbly`: what the pilot is, where it stands, and the
 * one button that opens the version the operator actually has to review.
 */
function pilotSummary(input: WarmblySurfaceInput): string {
  const list = gateSection(input, "list");
  const latest = latestCohort(input);
  const authority = operatorAuthority(input);
  const open = latest
    ? `<p><a class="button" data-open-review="true" href="#/warmbly/revisao?resource=${escapeHtml(show(latest.id))}">Abrir revisão da v${escapeHtml(show(latest.version))}</a></p>`
    : `<p><a class="button" data-open-cohorts="true" href="#/warmbly/cohorts">Abrir Cohorts para criar a primeira versão</a></p>`;
  return `
    <section class="stack" aria-labelledby="warmbly-piloto" data-pilot-summary="true">
      <h2 id="warmbly-piloto">Onde o piloto está</h2>
      <p class="constraint">Fonte → Cohort → Validação → Revisão → GO → Handoff. Cada passo abaixo repete o que o servidor devolveu; nada é recontado nesta tela. GO não envia e-mail e auto-send permanece desligado.</p>
      ${gateUnreadableBanner(list, "a lista de cohorts")}
      ${identityBlock(input)}
      ${stepperBlock(input)}
      ${
        latest
          ? `<article class="card" data-latest-cohort="${escapeHtml(show(latest.id))}">
              <p class="kicker"><span class="pill">${escapeHtml(show(latest.freshness))}</span> <span class="scope">${escapeHtml(show(latest.source))}</span></p>
              <h3>Versão mais recente: v${escapeHtml(show(latest.version))}</h3>
              <dl class="facts">
                ${fact("Identificador da versão", show(latest.id))}
                ${fact("as_of", show(latest.as_of))}
                ${fact("Decisão final", fromPayload(record(latest.decision).decision))}
                ${fact("Destinatários finais no preview", fromPayload(record(record(latest.manifest).preview).recipients_final))}
              </dl>
              ${open}
            </article>`
          : list.status === "read"
            ? `<article class="card" data-latest-cohort="none"><h3>Nenhuma cohort listada</h3><p>O servidor respondeu e não listou nenhuma versão. Uma cohort vazia nunca pode receber GO.</p>${open}</article>`
            : open
      }
      ${
        authority.canDecide
          ? ""
          : `<p class="constraint" data-go-authority="absent">Registrar GO/NO-GO exige o grupo <code>admins</code> no Authelia. Sua sessão ${
              authority.known ? "não tem esse grupo" : "não teve os grupos confirmados pelo canal"
            }: revisar continua permitido, e o controle de GO aparece desabilitado com o motivo na Revisão.</p>`
      }
    </section>`;
}

/* ------------------------------------------------------------------ *
 * Surface registry.
 * ------------------------------------------------------------------ */

function operationSurface(input: WarmblySurfaceInput): string {
  const operations = record(input.snapshot?.operations);
  const reading = readDispatch(operations);
  const lastAction = record(operations.last_operator_action);
  const hasLast = Object.keys(lastAction).length > 0;
  const feedback = feedbackRouter(input.operatorResult);
  return `
    ${pilotSummary(input)}
    ${feedback.remainder()}
    <section class="stack" aria-labelledby="warmbly-estado" data-dispatch-state="${escapeHtml(reading.state)}">
      <h2 id="warmbly-estado">Estado antes de agir</h2>
      ${stateBlock(reading, input.snapshot?.provenance)}
      <article class="card">
        <h3>Última ação do operador</h3>
        ${
          hasLast
            ? `<dl class="facts">
                ${fact("Ação", operatorActionLabel(show(lastAction.action)))}
                ${fact("Desfecho", operatorOutcomeLabel(show(lastAction.outcome)))}
                ${fact("Operador registrado", show(lastAction.actor_id))}
                ${fact("Quando", stamp(lastAction.recorded_at))}
                ${fact("Motivo registrado", show(lastAction.reason))}
              </dl>
              ${technicalDetails(
                [
                  { term: "action", value: show(lastAction.action) },
                  { term: "outcome", value: show(lastAction.outcome) },
                  { term: "refusal_code", value: show(lastAction.refusal_code) },
                ],
                "warmbly-last-action",
              )}`
            : `<p class="banner empty">Nenhuma ação de operador conhecida nesta instância. Veja a trilha abaixo antes de concluir que ninguém agiu.</p>`
        }
      </article>
    </section>
    ${controlsBlock(reading, input.confirmation)}
    ${auditBlock(operations, input.operator)}`;
}

/**
 * One entry per sub-surface. A sibling surface lands as one line here plus one
 * id in `WARMBLY_SURFACES` and one label above; the route, the subnav and the
 * dispatch below need no edit.
 */
const WARMBLY_SURFACE_RENDERERS: Record<WarmblySurface, WarmblySurfaceRenderer> = {
  operacao: operationSurface,
  cohorts: cohortSurface,
  revisao: reviewSurface,
};

function validationPill(candidate: Record<string, unknown>): string {
  const validation = record(candidate.validation);
  const observed = show(validation.status).toUpperCase();
  const status = ["VALID", "RISKY", "INVALID", "UNKNOWN", "STALE"].includes(observed)
    ? observed
    : "UNKNOWN";
  const tone = status === "VALID"
    ? "ok"
    : status === "INVALID"
      ? "error"
      : "stale";
  return `<span class="pill ${tone}" data-validation-status="${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

/**
 * Whether APPROVE is offered at all for this candidate.
 *
 * The server refuses APPROVE on anything but a current VALID validation. A UI
 * that renders the control anyway teaches the operator that approving is a
 * thing they may try, and then hands them a refusal with no explanation. The
 * verdict comes from the server's own `validation.status` plus its own
 * `blocked_by` — never from a date this screen compared itself.
 */
export function approvalGate(candidate: Record<string, unknown>): {
  allowed: boolean;
  reason: string;
} {
  const status = show(record(candidate.validation).status).toUpperCase();
  const blockers = Array.isArray(candidate.blocked_by)
    ? candidate.blocked_by.filter((entry): entry is string => typeof entry === "string")
    : [];
  const validationBlocker = blockers.find((entry) => entry.startsWith("validation"));
  if (validationBlocker) {
    return {
      allowed: false,
      reason: `O servidor marcou este candidato com o bloqueio "${validationBlocker}". Peça uma nova verificação do destinatário antes de aprovar.`,
    };
  }
  if (status === "VALID") return { allowed: true, reason: "" };
  if (status === NOT_IN_PAYLOAD.toUpperCase() || status === "—") {
    return {
      allowed: false,
      reason:
        "O payload não trouxe o estado da validação deste candidato. Sem validação vigente o servidor recusa APPROVE.",
    };
  }
  return {
    allowed: false,
    reason: `A validação deste destinatário está ${status}, não VALID. O servidor recusa APPROVE fora de uma validação vigente: peça a verificação e aprove só depois que ela voltar VALID.`,
  };
}

/* ------------------------------------------------------------------ *
 * Cohorts.
 * ------------------------------------------------------------------ */

function cohortSurface(input: WarmblySurfaceInput): string {
  const params = new URLSearchParams(input.query ?? "");
  const freshness = params.get("freshness") ?? "all";
  const decisionFilter = params.get("decision") ?? "all";
  const list = gateSection(input, "list");
  const authority = operatorAuthority(input);
  const feedback = feedbackRouter(input.operatorResult);
  const cohorts = cohortRows(input).filter((cohort) => {
    const decision = show(record(cohort.decision).decision);
    return (freshness === "all" || show(cohort.freshness) === freshness)
      && (decisionFilter === "all" || decision === decisionFilter);
  });
  const rows = cohorts.map((cohort) => {
    const preview = record(record(cohort.manifest).preview);
    const decision = record(cohort.decision);
    const id = show(cohort.id);
    return `<tr data-cohort-row="${escapeHtml(id)}"><td><a href="#/warmbly/revisao?resource=${escapeHtml(id)}">v${escapeHtml(show(cohort.version))}</a></td><td>${escapeHtml(show(cohort.freshness))}</td><td>${escapeHtml(fromPayload(preview.accounts_considered))}</td><td>${escapeHtml(fromPayload(preview.accounts_eligible))}</td><td>${escapeHtml(fromPayload(preview.accounts_excluded))}</td><td>${escapeHtml(fromPayload(preview.recipients_final))}</td><td>${escapeHtml(fromPayload(decision.decision))}</td><td><a class="button" data-open-review="true" href="#/warmbly/revisao?resource=${escapeHtml(id)}">Abrir revisão</a></td></tr>`;
  }).join("");
  const createKey = "create::::";
  const createPending = gateInFlight(createKey);
  return `<section class="stack" aria-labelledby="cohorts-title"><h2 id="cohorts-title">Cohorts versionadas</h2><p class="constraint">Denominadores vêm do preview Warmbly: considerados = elegíveis + excluídos e destinatários finais nunca são recalculados nesta tela. Auto-send permanece OFF.</p>
  ${gateUnreadableBanner(list, "a lista de cohorts")}
  ${feedback.remainder()}
  ${identityBlock(input)}
  <form class="filters" data-human-gate-filters="cohorts"><label>Freshness<select name="freshness"><option value="all">Todos</option><option value="FRESH"${freshness === "FRESH" ? " selected" : ""}>FRESH</option><option value="STALE"${freshness === "STALE" ? " selected" : ""}>STALE</option></select></label><label>Decisão<select name="decision"><option value="all">Todas</option><option value="GO"${decisionFilter === "GO" ? " selected" : ""}>GO</option><option value="NO_GO"${decisionFilter === "NO_GO" ? " selected" : ""}>NO_GO</option></select></label></form>
  ${createPending ? pendingBlock("Criando a cohort congelada") : ""}
  <form class="operator-form" data-human-gate="create" data-gate-key="${escapeHtml(createKey)}"><label>Tamanho pequeno (1–10)<input name="limit" type="number" min="1" max="10" value="5" required></label><button type="submit"${createPending || !authority.canReview ? " disabled" : ""}>${createPending ? "Enviando…" : "Criar cohort congelada"}</button>${
    authority.canReview
      ? ""
      : `<p class="constraint" data-blocked-reason="create">Criar cohort exige o grupo <code>operators</code> no Authelia.</p>`
  }</form>
  <div class="table-wrap"><table><thead><tr><th>Versão</th><th>Freshness</th><th>Considerados</th><th>Elegíveis</th><th>Excluídos</th><th>Finais</th><th>Decisão</th><th>Revisão</th></tr></thead><tbody>${rows || `<tr><td colspan="8">Nenhuma cohort ${list.status === "read" ? "listada pelo servidor" : "pôde ser lida"}. Uma cohort vazia nunca pode receber GO.</td></tr>`}</tbody></table></div></section>`;
}

/* ------------------------------------------------------------------ *
 * Revisão.
 * ------------------------------------------------------------------ */

/** Preview denominators, rendered verbatim with an explicit "não veio". */
function previewBlock(preview: Record<string, unknown>): string {
  const exclusions = record(preview.exclusions_by_reason);
  const exclusionRows = Object.keys(exclusions)
    .sort()
    .map((reason) => fact(`Excluídos por ${reason}`, fromPayload(exclusions[reason])))
    .join("");
  return `
    <article class="card" data-preview-denominators="true">
      <h3>Denominadores do preview</h3>
      <dl class="facts">
        ${fact("Considerados", fromPayload(preview.accounts_considered))}
        ${fact("Elegíveis", fromPayload(preview.accounts_eligible))}
        ${fact("Excluídos", fromPayload(preview.accounts_excluded))}
        ${fact("Destinatários finais", fromPayload(preview.recipients_final))}
        ${fact("Excluídos por suppression", fromPayload(preview.suppressed))}
        ${fact("Excluídos por opt-out", fromPayload(preview.opt_out))}
        ${fact("Excluídos por risco (risky)", fromPayload(preview.risky_excluded))}
        ${fact("Excluídos por duplicidade", fromPayload(preview.duplicates_excluded ?? preview.duplicate_excluded))}
        ${fact("Excluídos por hard bounce", fromPayload(preview.hard_bounce_excluded ?? preview.hard_bounce))}
        ${fact("Excluídos por falta de proveniência", fromPayload(preview.missing_provenance_excluded ?? preview.missing_provenance))}
        ${fact("Excluídos por reprovação de copy QA", fromPayload(preview.copy_qa_failed_excluded ?? preview.copy_qa_failed))}
        ${exclusionRows}
      </dl>
      <p class="constraint">Estes números são os do servidor. Onde está escrito &quot;${escapeHtml(NOT_IN_PAYLOAD)}&quot; o payload não trouxe o campo: a tela não soma, não subtrai e não infere o que falta.</p>
    </article>`;
}

/** Texto observado, ou nada. Objeto, vazio e nulo não contam como leitura. */
function textOf(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Primeira leitura observada entre as chaves que o servidor já usou. */
function firstText(...values: readonly unknown[]): string | null {
  for (const value of values) {
    const text = textOf(value);
    if (text !== null) return text;
  }
  return null;
}

/** Linha que só existe quando o servidor mandou o campo. Ausência não vira linha. */
function factWhenPresent(label: string, value: unknown, extra = ""): string {
  const text = textOf(value);
  return text === null ? "" : fact(label, text, extra);
}

/**
 * Linha cuja ausência muda a decisão, então a ausência fica escrita.
 * Sumir com um fato que falta é quase afirmar que ele está lá.
 */
function factOrAbsent(label: string, value: string | null, extra = ""): string {
  return value === null
    ? fact(label, NOT_IN_PAYLOAD, ` data-absent="true"${extra}`)
    : fact(label, value, extra);
}

/** Sinalizador do servidor: vira linha só quando é verdadeiro. false não é notícia. */
function flagText(value: unknown): string | null {
  if (value === true) return "sim";
  const text = textOf(value);
  if (text === null) return null;
  return ["false", "não", "nao", "nenhuma", "nenhum", "0"].includes(text.toLowerCase()) ? null : text;
}

/** Lista para o bloco técnico. Vazia vira "", e o bloco descarta "". */
function listValue(value: unknown): string {
  return Array.isArray(value)
    ? value
        .filter((entry) => typeof entry === "string" || typeof entry === "number")
        .map(String)
        .join(",")
    : "";
}

/** Valor cru para o bloco técnico. Ausente é "", que o bloco não renderiza. */
function techValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/**
 * One candidate, in three tiers: the message, the decision, the audit trail.
 *
 * Tier 1 is the exact subject and body, open by default. Hiding the only thing
 * a reviewer is there to review behind a closed `<details>` turns a review gate
 * into a rubber stamp.
 *
 * Tier 2 is the short block the founder actually judges an outbound email on:
 * recipient, kind of mailbox, route class, the observed fact and where it came
 * from, editorial state, and anything blocking. A field the server did not send
 * renders no row at all, with one deliberate exception: a missing fact, a
 * missing provenance, a missing validation and every blocker stay written out,
 * because their absence is the decision.
 *
 * Tier 3 is `technicalDetails`: hashes, versions, ids and the validation and
 * review receipts. They are evidence for an audit, not input to the judgement,
 * and stacked as visible rows they buried the message under a wall of
 * "não informado pelo servidor".
 */
function candidateCard(
  cohort: Record<string, unknown>,
  candidate: Record<string, unknown>,
  authority: OperatorAuthority,
  feedback: FeedbackRouter,
  expandAll: boolean,
): string {
  const cohortId = show(cohort.id);
  const candidateId = show(candidate.candidate_id);
  const validation = record(candidate.validation);
  const review = record(candidate.review);
  // Produção manda `observed_fact` e `fact_source` como texto simples. Ler o
  // texto como objeto fazia o fato real sair como "não informado pelo servidor"
  // embaixo de uma mensagem que afirmava exatamente esse fato. O formato objeto
  // de versões antigas continua sendo aceito como alternativa.
  const evidence = record(candidate.evidence ?? candidate.observed_fact);
  const observedFact = firstText(
    candidate.observed_fact,
    candidate.observed_fact_text,
    evidence.text,
    evidence.summary,
  );
  const factSource = firstText(
    candidate.fact_source,
    candidate.evidence_source,
    evidence.source,
    evidence.locator,
  );
  const observedAt = firstText(candidate.evidence_observed_at, evidence.observed_at);
  const copyQa = record(candidate.copy_qa);
  const blockers = Array.isArray(candidate.blocked_by)
    ? candidate.blocked_by.filter((entry): entry is string => typeof entry === "string")
    : [];
  const gate = approvalGate(candidate);
  // A candidate inherits the version's editorial verdict: nothing inside a
  // historical version is decidable, however the candidate itself is stamped.
  const editorial = mergeEditorialState(readEditorialState(cohort), readEditorialState(candidate));
  // expected_frozen_hash guards the VERSION the operator was looking at, so it
  // is the cohort's frozen_hash. A candidate carries content_hash and
  // evidence_hash and no frozen_hash of its own, so reading it from the
  // candidate sent the content hash and the server refused every adjust with
  // frozen_hash_mismatch. The candidate value is kept only as a last resort.
  const frozenHash = show(cohort.frozen_hash ?? candidate.frozen_hash ?? candidate.content_hash);
  const version = show(cohort.version);
  const draft = adjustDraft(candidateId);

  const routeClassRaw = textOf(candidate.route_class);
  const routeClassLabelText = routeClassRaw === null ? null : routeClassLabel(routeClassRaw);
  const routeClassText =
    routeClassRaw === null || routeClassLabelText === null
      ? null
      : routeClassLabelText === routeClassRaw
        ? routeClassRaw
        : `${routeClassLabelText} (${routeClassRaw})`;
  const routeClassAttr =
    routeClassRaw === null ? "" : ` data-route-class="${escapeHtml(routeClassRaw)}"`;

  // mailbox_purpose usa o mesmo vocabulário da classe de rota. UNKNOWN é o
  // servidor dizendo que não classificou: não muda a decisão e a classe de
  // rota logo acima já responde se a caixa é genérica ou de departamento.
  // O valor cru continua no detalhe técnico.
  const purposeRaw = textOf(candidate.mailbox_purpose);
  const purposeText =
    purposeRaw === null || purposeRaw.toUpperCase() === "UNKNOWN"
      ? null
      : routeClassLabel(purposeRaw) === purposeRaw
        ? purposeRaw
        : `${routeClassLabel(purposeRaw)} (${purposeRaw})`;

  // VALID já está no pill do topo. A linha existe para o que trava a decisão:
  // um estado que não é VALID, ou nenhuma validação lida.
  const validationStatus = textOf(validation.status);
  const validationReason = textOf(validation.reason);
  const validationVisible = validationStatus === null || validationStatus.toUpperCase() !== "VALID";
  const validationLine =
    validationStatus === null
      ? null
      : validationReason === null
        ? validationStatus
        : `${validationStatus}: ${validationReason}`;

  // Um corpo escrito afirma uma observação específica ao destinatário. Se o
  // fato ou a origem dele não vieram, isso não some do card: é o motivo para
  // não aprovar.
  const bodyAsserts = textOf(candidate.body_text) !== null;
  const factGap =
    !bodyAsserts || (observedFact !== null && factSource !== null)
      ? null
      : observedFact === null && factSource === null
        ? "nem o fato observado nem a proveniência dele"
        : observedFact === null
          ? "o fato observado"
          : "a proveniência do fato";

  const validateKey = `validate:${cohortId}:${candidateId}:`;
  const approveKey = `review:${cohortId}:${candidateId}:APPROVE`;
  const holdKey = `review:${cohortId}:${candidateId}:HOLD_REJECT`;
  const adjustKey = `adjust:${cohortId}:${candidateId}:`;

  const copyQaFailures = Array.isArray(copyQa.failures)
    ? copyQa.failures.filter((entry): entry is string => typeof entry === "string")
    : Array.isArray(candidate.copy_qa_failures)
      ? candidate.copy_qa_failures.filter((entry): entry is string => typeof entry === "string")
      : [];

  // Not merely disabled: a historical version emits no decision markup at all,
  // so there is nothing for devtools to re-enable.
  const controls = editorial.actionable
    ? `
    ${gateInFlight(validateKey) ? pendingBlock("Pedindo a verificação do destinatário") : ""}
    <form class="operator-form" data-human-gate="validate" data-gate-key="${escapeHtml(validateKey)}" data-version="${escapeHtml(cohortId)}" data-candidate="${escapeHtml(candidateId)}">
      <p class="constraint">Pede ao Warmbly que verifique agora se este endereço aceita entrega. Não envia mensagem nenhuma.</p>
      <button type="submit"${gateInFlight(validateKey) || !authority.canReview ? " disabled" : ""}>${gateInFlight(validateKey) ? "Enviando…" : "Verificar o destinatário agora"}</button>
    </form>

    ${gateInFlight(approveKey) ? pendingBlock("Registrando a aprovação") : ""}
    <form class="operator-form" data-human-gate="review" data-gate-key="${escapeHtml(approveKey)}" data-decision="APPROVE" data-version="${escapeHtml(cohortId)}" data-candidate="${escapeHtml(candidateId)}">
      <h4>Aprovar este candidato</h4>
      <label>Motivo<input name="reason" required minlength="3"></label>
      <label><input type="checkbox" name="ack"${gate.allowed ? " required" : ""}${gate.allowed ? "" : " disabled"}> Revisei destinatário, mensagem exata, policy e evidência desta versão</label>
      <button type="submit"${gate.allowed && authority.canReview && !gateInFlight(approveKey) ? "" : " disabled"}>${gateInFlight(approveKey) ? "Enviando…" : "Registrar APPROVE"}</button>
      ${
        gate.allowed
          ? ""
          : `<p class="constraint" data-approve-blocked="true">APPROVE está desabilitado: ${escapeHtml(gate.reason)}</p>`
      }
      ${
        authority.canReview
          ? ""
          : `<p class="constraint" data-blocked-reason="review">Revisar exige o grupo <code>operators</code> no Authelia.</p>`
      }
    </form>

    ${gateInFlight(holdKey) ? pendingBlock("Registrando HOLD/REJECT") : ""}
    <form class="operator-form" data-human-gate="review" data-gate-key="${escapeHtml(holdKey)}" data-version="${escapeHtml(cohortId)}" data-candidate="${escapeHtml(candidateId)}">
      <h4>Segurar ou rejeitar</h4>
      <label>Decisão<select name="decision"><option value="HOLD">HOLD</option><option value="REJECT">REJECT</option></select></label>
      <label>Motivo<input name="reason" required minlength="3"></label>
      <p class="constraint" data-no-ack-required="true">HOLD e REJECT não pedem a ciência de aprovação: segurar ou rejeitar nunca autoriza uma mensagem.</p>
      <button type="submit"${authority.canReview && !gateInFlight(holdKey) ? "" : " disabled"}>${gateInFlight(holdKey) ? "Enviando…" : "Registrar HOLD/REJECT"}</button>
    </form>

    ${adjustBlock({ cohortId, candidateId, version, frozenHash, candidate, authority, adjustKey, draft })}
`
    : `<p class="constraint" data-non-actionable-notice="true">Versão histórica, não enviável. Verificar o destinatário, aprovar, segurar e ajustar não são oferecidos aqui. Abra a versão corrente pelo link no topo desta página.</p>`;

  return `<article class="card" data-candidate-id="${escapeHtml(candidateId)}" data-editorial-state="${escapeHtml(editorial.state)}" data-actionable="${editorial.actionable ? "true" : "false"}" data-approve-allowed="${gate.allowed && editorial.actionable ? "true" : "false"}">
    <p class="kicker">${validationPill(candidate)}${editorial.legacy ? ` <span class="pill error" data-non-actionable="true">NÃO ACIONÁVEL</span>` : ""} · ${escapeHtml(show(candidate.source))}</p>
    <h3>${escapeHtml(show(candidate.company))}</h3>
    ${feedback.forCandidate(candidateId)}
    <details data-message-preview="true"${expandAll ? " open" : ""}>
      <summary>Mensagem exata congelada (assunto e corpo). ${editorial.legacy ? "Versão histórica, não enviar." : "Versão corrente."}</summary>
      <p data-exact-subject="true"><strong>Assunto:</strong> ${escapeHtml(show(candidate.subject))}</p>
      <pre class="message-preview" data-exact-body="true">${escapeHtml(show(candidate.body_text))}</pre>
    </details>
    ${
      factGap
        ? `<p class="banner error" role="alert" data-fact-missing="true">A mensagem afirma uma observação específica sobre esta empresa, mas o servidor não enviou ${escapeHtml(factGap)}. Não dá para conferir o que a mensagem diz ao destinatário: recupere a evidência antes de aprovar.</p>`
        : ""
    }
    ${
      blockers.length > 0
        ? `<p class="banner error" role="alert" data-candidate-blockers="${escapeHtml(blockers.join(" "))}">O servidor registrou ${blockers.length} bloqueio(s) neste candidato: ${escapeHtml(blockers.join(", "))}.</p>`
        : ""
    }
    <dl class="facts" data-candidate-identity="true" data-candidate-decision="true">
      ${fact("Destinatário exato", show(candidate.mailbox))}
      ${factWhenPresent("Tipo de caixa", purposeText)}
      ${factOrAbsent("Classe de rota", routeClassText, routeClassAttr)}
      ${factOrAbsent("Fato observado", observedFact, ` data-observed-fact="true"`)}
      ${factOrAbsent("Proveniência do fato", factSource, ` data-fact-source="true"`)}
      ${fact("Estado editorial", editorial.legacy ? "Versão histórica (não enviável)" : "Versão corrente")}
      ${editorial.reasonCodes.length > 0 ? fact("Motivos do estado editorial", editorial.reasonCodes.map(editorialReasonLabel).join(", ")) : ""}
      ${validationVisible ? factOrAbsent("Validação", validationLine) : ""}
      ${copyQaFailures.length > 0 ? fact("Reprovações de copy QA", copyQaFailures.join(", ")) : ""}
      ${factWhenPresent("Duplicidade apontada pelo servidor", flagText(candidate.duplicate_of ?? candidate.duplicate))}
      ${factWhenPresent("Proveniência ausente", flagText(candidate.missing_provenance))}
      ${factWhenPresent("Hard bounce registrado", flagText(candidate.hard_bounce))}
      ${factWhenPresent("Excluído do preview por", flagText(candidate.exclusion_reason ?? candidate.excluded_reason))}
    </dl>

    ${controls}
    ${technicalDetails(
      [
        { term: "candidate_id", value: candidateId },
        { term: "candidate_ref", value: techValue(candidate.candidate_ref) },
        { term: "account_id", value: techValue(candidate.account_id) },
        { term: "account_ref", value: techValue(candidate.account_ref) },
        { term: "route_class", value: techValue(candidate.route_class) },
        { term: "mailbox_purpose", value: techValue(candidate.mailbox_purpose) },
        { term: "content_hash", value: techValue(candidate.content_hash) },
        // frozen_hash é da versão, não do candidato: é o que expected_frozen_hash
        // guarda. Ler do candidato mostrava vazio e escondia o hash real.
        { term: "frozen_hash", value: techValue(cohort.frozen_hash ?? candidate.frozen_hash) },
        { term: "evidence_hash", value: techValue(candidate.evidence_hash) },
        { term: "policy_version", value: techValue(cohort.policy_version) },
        { term: "composer_version", value: techValue(candidate.composer_version ?? cohort.composer_version) },
        { term: "fact_observed_at", value: observedAt === null ? "" : observedAt },
        { term: "validation_status", value: techValue(validation.status) },
        { term: "validation_reason", value: techValue(validation.reason) },
        { term: "validation_expires_at", value: validation.expires_at ? stamp(validation.expires_at) : "" },
        { term: "review_decision", value: techValue(review.decision) },
        { term: "review_effective", value: techValue(review.effective) },
        { term: "blocked_by", value: blockers.join(",") },
        { term: "copy_qa_failures", value: copyQaFailures.length > 0 ? copyQaFailures.join(",") : listValue(copyQa.failures) },
        { term: "admission_reasons", value: listValue(candidate.admission_reasons) },
        { term: "route_reasons", value: listValue(candidate.route_reasons) },
        { term: "duplicate_of", value: techValue(candidate.duplicate_of ?? candidate.duplicate) },
        { term: "missing_provenance", value: techValue(candidate.missing_provenance) },
        { term: "hard_bounce", value: techValue(candidate.hard_bounce) },
        { term: "exclusion_reason", value: techValue(candidate.exclusion_reason ?? candidate.excluded_reason) },
        { term: "editorial_state", value: editorial.state },
        { term: "editorial_reason_codes", value: editorial.reasonCodes.join(",") },
      ],
      "warmbly-candidate",
    )}
  </article>`;
}

/**
 * The adjust editor: exactly three fields, and a preview before the write.
 *
 * The contract accepts subject, body_text and reason and nothing else, so there
 * is nothing here that could offer to change mailbox, evidence, source, policy
 * or route class — the fields that make the frozen cohort worth trusting.
 */
function adjustBlock(args: {
  cohortId: string;
  candidateId: string;
  version: string;
  frozenHash: string;
  candidate: Record<string, unknown>;
  authority: OperatorAuthority;
  adjustKey: string;
  draft: AdjustDraft | undefined;
}): string {
  const { cohortId, candidateId, version, frozenHash, candidate, authority, adjustKey, draft } = args;
  const unavailable = adjustRouteMissing();
  const pending = gateInFlight(adjustKey);
  const subject = show(candidate.subject);
  const body = show(candidate.body_text);
  const diff = draft
    ? `
      <div class="banner stale" role="status" data-adjust-diff="true">
        <h4>Confira a mudança antes de confirmar</h4>
        <dl class="facts">
          <div data-diff-field="subject"><dt>Assunto</dt><dd><del>${escapeHtml(draft.before_subject)}</del><br><ins>${escapeHtml(draft.subject)}</ins></dd></div>
          <div data-diff-field="body_text"><dt>Corpo</dt><dd><del><pre class="message-preview">${escapeHtml(draft.before_body_text)}</pre></del><ins><pre class="message-preview">${escapeHtml(draft.body_text)}</pre></ins></dd></div>
          <div data-diff-field="reason"><dt>Motivo</dt><dd>${escapeHtml(draft.reason)}</dd></div>
        </dl>
        <p class="constraint">Confirmar cria a versão seguinte. A versão v${escapeHtml(version)} continua existindo e legível; validação, revisão e GO da nova versão começam pendentes.</p>
      </div>`
    : "";
  return `
    <details class="card" data-adjust-editor="${escapeHtml(candidateId)}"${draft ? " open" : ""}>
      <summary>Ajustar assunto e corpo (cria uma NOVA versão)</summary>
      <p class="constraint" data-adjust-warning="true">Ajustar não edita esta versão: o Warmbly congela uma versão nova a partir dela. Destinatário, evidência, origem, policy e classe de rota são imutáveis e não aparecem aqui porque não podem ser alterados.</p>
      ${
        unavailable
          ? `<p class="banner error" role="alert" data-adjust-unavailable="true">A rota de ajuste ainda não está implantada neste Control Center, então este editor não pode gravar. Registre HOLD ou REJECT com o motivo enquanto isso.</p>`
          : ""
      }
      ${pending ? pendingBlock("Enviando o ajuste") : ""}
      ${diff}
      <form class="operator-form" data-human-gate="adjust" data-gate-key="${escapeHtml(adjustKey)}" data-version="${escapeHtml(cohortId)}" data-candidate="${escapeHtml(candidateId)}" data-cohort-version="${escapeHtml(version)}" data-frozen-hash="${escapeHtml(frozenHash)}" data-before-subject="${escapeHtml(subject)}" data-before-body="${escapeHtml(body)}" data-adjust-step="${draft ? "confirm" : "preview"}">
        <label>Assunto<input name="subject" required minlength="3" maxlength="200" value="${escapeHtml(draft?.subject ?? subject)}"></label>
        <label>Corpo<textarea name="body_text" required minlength="3" rows="8">${escapeHtml(draft?.body_text ?? body)}</textarea></label>
        <label>Motivo do ajuste<input name="reason" required minlength="3" value="${escapeHtml(draft?.reason ?? "")}"></label>
        <label>Confirme digitando <code>v${escapeHtml(version)}</code><input name="confirmation" required pattern="v${escapeHtml(version)}" value="${escapeHtml(draft ? `v${version}` : "")}"></label>
        <button type="submit"${pending || unavailable || !authority.canReview ? " disabled" : ""}>${
          pending ? "Enviando…" : draft ? `Confirmar e criar a versão seguinte a partir da v${escapeHtml(version)}` : "Pré-visualizar a mudança"
        }</button>
        ${
          authority.canReview
            ? ""
            : `<p class="constraint" data-blocked-reason="adjust">Ajustar exige o grupo <code>operators</code> no Authelia.</p>`
        }
      </form>
    </details>`;
}

/**
 * The founder's escape hatch out of a historical version.
 *
 * Loud, first thing on the page, and carrying the link to the current version
 * as its primary control. Nothing below it is decidable.
 */
function legacyBanner(editorial: EditorialReading, cohortId: string): string {
  if (!editorial.legacy) return "";
  const reasons = editorialReasonSentence(editorial.reasonCodes);
  const linkable = editorial.currentVersionId !== "" && editorial.currentVersionId !== cohortId;
  return `<section class="banner error" role="alert" data-legacy-banner="true" data-editorial-state="${escapeHtml(editorial.state)}">
    <h3>Versão histórica. Não enviar.</h3>
    <p data-legacy-summary="true">Esta é uma versão antiga desta cohort, mantida legível só para auditoria. A mensagem abaixo não é enviável: aprovar, ajustar, verificar e registrar GO não são oferecidos nesta tela.</p>
    ${reasons ? `<p data-legacy-reasons="true">Por que ficou histórica: ${escapeHtml(reasons)}.</p>` : ""}
    ${editorial.notice ? `<p data-editorial-notice="true">${escapeHtml(editorial.notice)}</p>` : ""}
    ${
      linkable
        ? `<p><a class="button" data-open-current="true" href="#/warmbly/revisao?resource=${escapeHtml(editorial.currentVersionId)}">Abrir versão corrente</a>${
            editorial.currentVersion ? ` <span class="scope">v${escapeHtml(editorial.currentVersion)}</span>` : ""
          }</p>`
        : `<p class="constraint" data-open-current="absent">O servidor não informou qual é a versão corrente desta cohort, então esta tela não inventa um link. Abra Cohorts para achá-la.</p>`
    }
  </section>`;
}

function reviewSurface(input: WarmblySurfaceInput): string {
  const selected = gateSection(input, "selected");
  const list = gateSection(input, "list");
  const cohort = selectedCohort(input);
  const authority = operatorAuthority(input);
  const feedback = feedbackRouter(input.operatorResult);
  if (!cohort.id) {
    // Never a silently empty page. Either the operator picks from what the
    // server listed, or they are told plainly that the list itself could not
    // be read — those are different situations with different next moves.
    const options = cohortRows(input)
      .map(
        (row) =>
          `<li class="card" data-cohort-option="${escapeHtml(show(row.id))}"><h3>v${escapeHtml(show(row.version))} · ${escapeHtml(show(row.freshness))}</h3><dl class="facts">${fact("Origem", show(row.source))}${fact("as_of", show(row.as_of))}${fact("Decisão final", fromPayload(record(row.decision).decision))}</dl><p><a class="button" data-open-review="true" href="#/warmbly/revisao?resource=${escapeHtml(show(row.id))}">Abrir revisão</a></p></li>`,
      )
      .join("");
    return `<section class="stack" data-review-empty="true"><h2>Revisão</h2>
      ${feedback.remainder()}
      ${input.resource ? gateUnreadableBanner(selected, "a versão selecionada") : ""}
      ${gateUnreadableBanner(list, "a lista de cohorts")}
      <p class="banner empty">Nenhuma versão selecionada. Escolha uma abaixo — nenhuma elegibilidade é inferida localmente.</p>
      ${
        options
          ? `<ol class="stack" data-cohort-selector="true">${options}</ol>`
          : `<p><a class="button" data-open-cohorts="true" href="#/warmbly/cohorts">Abrir Cohorts</a></p>`
      }
      </section>`;
  }
  const manifest = record(cohort.manifest);
  const preview = record(manifest.preview);
  const candidates = array(cohort.candidates);
  const expandAll = new URLSearchParams(input.query ?? "").get("mensagens") !== "recolhidas";
  const cohortId = show(cohort.id);
  const version = show(cohort.version);
  const reproduceKey = `reproduce:${cohortId}::`;
  const decideKey = `decide:${cohortId}::`;
  const candidateCards = candidates
    .map((candidate) => candidateCard(cohort, candidate, authority, feedback, expandAll))
    .join("");
  const cohortFeedback = feedback.forCohort(cohortId);
  const leftover = feedback.remainder();
  const decisionValue = fromPayload(record(cohort.decision).decision);
  const editorial = readEditorialState(cohort);
  // A historical version emits neither the GO/NO-GO form nor the reproduce
  // form. The facts below them stay: this removes decisions, not information.
  const reproduceControl = editorial.actionable
    ? `
  ${gateInFlight(reproduceKey) ? pendingBlock("Reproduzindo a versão imutável") : ""}
  <form class="operator-form" data-human-gate="reproduce" data-gate-key="${escapeHtml(reproduceKey)}" data-version="${escapeHtml(cohortId)}"><button type="submit"${gateInFlight(reproduceKey) || !authority.canReview ? " disabled" : ""}>${gateInFlight(reproduceKey) ? "Enviando…" : "Reproduzir versão imutável"}</button></form>
`
    : "";
  const decideControl = editorial.actionable
    ? `
  ${gateInFlight(decideKey) ? pendingBlock("Registrando GO/NO-GO") : ""}
  <form class="operator-form" data-human-gate="decide" data-gate-key="${escapeHtml(decideKey)}" data-version="${escapeHtml(cohortId)}"><label>Decisão final<select name="decision"><option value="NO_GO">NO_GO</option><option value="GO">GO</option></select></label><label>Motivo<input name="reason" required minlength="3"></label><label>Confirme digitando <code>v${escapeHtml(version)}</code><input name="confirmation" required pattern="v${escapeHtml(version)}"></label><button type="submit"${authority.canDecide && !gateInFlight(decideKey) ? "" : " disabled"}>${gateInFlight(decideKey) ? "Enviando…" : "Registrar GO/NO-GO"}</button>${
    authority.canDecide
      ? ""
      : `<p class="constraint" data-go-authority="absent">GO/NO-GO está desabilitado nesta sessão: ele exige o grupo <code>admins</code> no Authelia. Peça a inclusão nesse grupo e reautentique; revisar candidatos continua permitido com <code>operators</code>.</p>`
  }</form>
`
    : `<p class="constraint" data-non-actionable-surface="true">Versão histórica, não enviável. GO/NO-GO e a reprodução da versão imutável não são oferecidos aqui. Decida na versão corrente.</p>`;
  return `<section class="stack" aria-labelledby="review-title" data-review-cohort="${escapeHtml(cohortId)}" data-editorial-state="${escapeHtml(editorial.state)}" data-actionable="${editorial.actionable ? "true" : "false"}"><h2 id="review-title">Revisão v${escapeHtml(version)}</h2>
  ${legacyBanner(editorial, cohortId)}
  ${leftover}${cohortFeedback}
  ${gateUnreadableBanner(selected, "a versão selecionada")}
  <p class="constraint">${escapeHtml(show(cohort.source))}, as_of ${escapeHtml(show(cohort.as_of))}, ${escapeHtml(show(cohort.freshness))}, policy ${escapeHtml(show(cohort.policy_version))}. Receipt ${escapeHtml(show(cohort.receipt))}.</p>
  ${identityBlock(input)}
  ${previewBlock(preview)}
  <p><button type="button" data-toggle-messages="true" aria-expanded="${expandAll ? "true" : "false"}">${expandAll ? "Recolher todas as mensagens" : "Expandir todas as mensagens"}</button></p>
  ${reproduceControl}
  ${candidateCards || `<p class="banner error">Cohort vazia: GO bloqueado.</p>`}
  ${decideControl}
  <dl class="facts"><div><dt>Decisão final registrada</dt><dd>${escapeHtml(decisionValue)}</dd></div></dl>
  <p class="constraint">GO não envia e-mail. O Control Center não expõe dispatch, queue ou send neste gate.</p></section>`;
}

function warmblySubnav(current: WarmblySurface, resource: string | null | undefined): string {
  // The resource travels with the operator. A subnav that drops it lands the
  // reviewer on an empty Revisão and makes the selection they just made look
  // like it never happened.
  const suffix = resource ? `?resource=${encodeURIComponent(resource)}` : "";
  return `<nav class="subnav" aria-label="Superfícies de operação Warmbly">${WARMBLY_SURFACES.map(
    (id) =>
      `<a href="#/warmbly/${id}${suffix}" data-surface="${id}" aria-current="${current === id ? "page" : "false"}">${escapeHtml(
        ownMapValue(WARMBLY_SURFACE_LABELS, id) ?? "Operação",
      )}</a>`,
  ).join("")}</nav>`;
}

export function resolveWarmblySurface(surface: string | null | undefined): WarmblySurface {
  return isWarmblySurface(surface) ? surface : DEFAULT_WARMBLY_SURFACE;
}

export function warmblyBlock(input: WarmblySurfaceInput, surface: string | null | undefined): string {
  const current = resolveWarmblySurface(surface);
  const render = ownMapValue(WARMBLY_SURFACE_RENDERERS, current) ?? operationSurface;
  return `${warmblySubnav(current, input.resource)}${render(input)}`;
}
